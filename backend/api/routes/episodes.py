from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from api.schemas import EpisodeDetail, EpisodeSummary
from config import settings

router = APIRouter(prefix="/api/episodes", tags=["episodes"])


def _load_manifest() -> dict:
    p = Path("storage/manifest.json")
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


def _scan_transcripts() -> list[dict]:
    """Scan transcript directory and extract front matter metadata."""
    transcript_dir = Path(settings.transcript_dir)
    if not transcript_dir.exists():
        return []

    seen: set[int] = set()
    episodes = []
    for md_file in sorted(transcript_dir.glob("*.md")):
        meta = _parse_front_matter(md_file)
        if meta:
            ep_num = meta.get("episode", 0)
            if ep_num in seen:
                continue
            seen.add(ep_num)
            episodes.append(meta)

    return sorted(episodes, key=lambda e: e.get("episode", 0))


def _parse_front_matter(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8-sig")  # utf-8-sig strips BOM
    if not text.startswith("---"):
        return None

    end = text.find("---", 3)
    if end == -1:
        return None

    import yaml

    try:
        meta = yaml.safe_load(text[3:end])
    except Exception:
        return None

    if not isinstance(meta, dict):
        return None

    meta["_transcript_path"] = str(path)
    meta["_transcript_body"] = text[end + 3 :].strip()
    return meta


@router.get("", response_model=list[EpisodeSummary])
async def list_episodes(
    search: str = Query(None, max_length=200),
    date_from: str = Query(None),
    date_to: str = Query(None),
):
    episodes = _scan_transcripts()

    if search:
        q = search.lower()
        episodes = [
            e for e in episodes
            if q in e.get("title", "").lower()
            or q in e.get("_transcript_body", "").lower()
        ]

    if date_from:
        episodes = [e for e in episodes if str(e.get("date", "")) >= date_from]
    if date_to:
        episodes = [e for e in episodes if str(e.get("date", "")) <= date_to]

    return [
        EpisodeSummary(
            episode_number=e.get("episode", 0),
            title=e.get("title", ""),
            date=str(e.get("date", "")),
            duration=e.get("duration", ""),
            description=e.get("_transcript_body", "")[:200],
            keywords=e.get("keywords", []),
            status="done",
        )
        for e in episodes
    ]


@router.get("/{episode_number}", response_model=EpisodeDetail)
async def get_episode(episode_number: int):
    episodes = _scan_transcripts()
    match = [e for e in episodes if e.get("episode") == episode_number]

    if not match:
        raise HTTPException(status_code=404, detail="Episode not found")

    e = match[0]
    return EpisodeDetail(
        episode_number=e.get("episode", 0),
        title=e.get("title", ""),
        date=str(e.get("date", "")),
        duration=e.get("duration", ""),
        description=e.get("_transcript_body", "")[:200],
        url=e.get("url", ""),
        keywords=e.get("keywords", []),
        transcript=e.get("_transcript_body"),
    )
