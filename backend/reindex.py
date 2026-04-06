"""
reindex.py — Rebuild ChromaDB from existing transcript .md files.

Run this on first cloud deploy (or whenever ChromaDB is empty/wiped).
Does NOT require audio files or re-transcription.

Usage:
    python reindex.py              # Index all transcripts
    python reindex.py --force      # Wipe and rebuild from scratch
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from config import settings

# Log to both console and file
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("reindex.log", mode="w", encoding="utf-8"),
    ],
)
logger = logging.getLogger("reindex")


def _count_chroma_docs() -> int:
    """Return number of documents currently in ChromaDB."""
    try:
        import chromadb
        client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        col = client.get_or_create_collection("utbytte_episodes")
        return col.count()
    except Exception:
        return 0


def _episode_from_md(md_path: Path) -> "Episode | None":
    """Construct a minimal Episode from a transcript .md filename + JSONL metadata."""
    from models.episode import Episode

    stem = md_path.stem  # e.g. "001_svakere-globalt---bra-fart-lokalt"
    try:
        ep_num = int(stem.split("_")[0])
    except (ValueError, IndexError):
        logger.warning("Cannot parse episode number from %s", md_path.name)
        return None

    # Try to load metadata from sibling .jsonl
    jsonl_path = md_path.with_suffix(".jsonl")
    title = stem[4:].replace("-", " ").title()
    pub_date = date(2020, 1, 1)
    url = ""
    audio_url = ""

    if jsonl_path.exists():
        try:
            with jsonl_path.open(encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    obj = json.loads(line)
                    if obj.get("type") == "metadata":
                        meta = obj.get("data", {})
                        title = meta.get("title", title)
                        raw_date = meta.get("publish_date") or meta.get("date", "")
                        if raw_date:
                            try:
                                pub_date = date.fromisoformat(str(raw_date)[:10])
                            except ValueError:
                                pass
                        url = meta.get("url", url)
                        audio_url = meta.get("audio_url", audio_url)
                    break  # only need first metadata line
        except Exception as e:
            logger.warning("Could not read %s: %s", jsonl_path.name, e)

    ep = Episode(
        title=title,
        episode_number=ep_num,
        publish_date=pub_date,
        url=url,
        audio_url=audio_url,
        transcript_path=str(md_path),
        status="transcribed",
    )
    return ep


async def reindex(force: bool = False, start: int = 0, end: int = 0) -> None:
    from agents.base import AgentMessage
    from agents.chunker import ChunkerAgent
    from agents.database import DatabaseAgent

    settings.ensure_dirs()

    transcript_dir = Path(settings.transcript_dir)
    md_files = sorted(transcript_dir.glob("*.md"))

    if not md_files:
        logger.error("No .md transcript files found in %s", transcript_dir)
        sys.exit(1)

    # Filter by episode range if specified
    if start or end:
        filtered = []
        for f in md_files:
            try:
                ep_num = int(f.stem.split("_")[0])
            except (ValueError, IndexError):
                continue
            if start and ep_num < start:
                continue
            if end and ep_num > end:
                continue
            filtered.append(f)
        md_files = filtered
        logger.info("Filtered to %d transcript files (episodes %s-%s)", len(md_files), start or "1", end or "end")
    else:
        logger.info("Found %d transcript files", len(md_files))

    if force:
        logger.info("--force: wiping ChromaDB collection...")
        import chromadb
        client = chromadb.PersistentClient(path=settings.chroma_persist_dir)
        try:
            client.delete_collection("utbytte_episodes")
            logger.info("Collection deleted")
        except Exception:
            pass

    chunker = ChunkerAgent()
    db = DatabaseAgent()

    already = _count_chroma_docs()
    logger.info("ChromaDB currently has %d documents", already)

    success = 0
    failed = 0

    for md_path in md_files:
        ep = _episode_from_md(md_path)
        if ep is None:
            failed += 1
            continue

        logger.info("[%03d] %s", ep.episode_number, ep.title[:60])

        chunk_result = await chunker.run(AgentMessage(sender="reindex", msg_type="chunk", payload=ep))
        if not chunk_result.success:
            logger.warning("  Chunk failed: %s", chunk_result.error)
            failed += 1
            continue

        db_result = await db.run(AgentMessage(sender="reindex", msg_type="store", payload=chunk_result.data))
        if not db_result.success:
            logger.warning("  DB failed: %s", db_result.error)
            failed += 1
            continue

        success += 1
        # Throttle between episodes for disk I/O stability
        await asyncio.sleep(1.5)
    total = _count_chroma_docs()
    logger.info("Done. Indexed %d episodes (%d failed). ChromaDB now has %d docs.", success, failed, total)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild ChromaDB from transcripts")
    parser.add_argument("--force", action="store_true", help="Wipe and rebuild from scratch")
    parser.add_argument("--start", type=int, default=0, help="Start from this episode number")
    parser.add_argument("--end", type=int, default=0, help="End at this episode number")
    args = parser.parse_args()
    asyncio.run(reindex(force=args.force, start=args.start, end=args.end))


if __name__ == "__main__":
    main()
