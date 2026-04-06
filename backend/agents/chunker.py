from __future__ import annotations

import logging
import re
import threading
from pathlib import Path

import tiktoken
from sentence_transformers import SentenceTransformer

from agents.base import AgentMessage, AgentResult, BaseAgent
from config import settings
from models.chunk import Chunk
from models.episode import Episode

logger = logging.getLogger(__name__)

# Module-level singleton so all ChunkerAgent instances share one model.
# The lock prevents meta-tensor race when multiple threads load simultaneously.
_model_lock = threading.Lock()
_shared_model: SentenceTransformer | None = None


def _get_shared_model() -> SentenceTransformer:
    global _shared_model
    if _shared_model is None:
        with _model_lock:
            if _shared_model is None:
                logger.info("Loading embedding model '%s'...", settings.embedding_model)
                _shared_model = SentenceTransformer(settings.embedding_model)
    return _shared_model


class ChunkerAgent(BaseAgent):
    """Splits transcripts into token-sized chunks and generates embeddings locally."""

    def __init__(self) -> None:
        super().__init__("chunker")
        self._tokenizer = tiktoken.get_encoding("cl100k_base")

    def _get_model(self) -> SentenceTransformer:
        return _get_shared_model()

    async def run(self, message: AgentMessage) -> AgentResult:
        episode: Episode = message.payload

        if not episode.transcript_path:
            return AgentResult(success=False, error="No transcript path — transcribe first")

        md_path = Path(episode.transcript_path)
        if not md_path.exists():
            return AgentResult(success=False, error=f"Transcript not found: {md_path}")

        await self._report_progress(0, f"Chunking {episode.title}...")

        # Read and strip YAML front matter
        raw = md_path.read_text(encoding="utf-8")
        text = self._strip_front_matter(raw)

        # Split into chunks
        chunks = self._split_into_chunks(
            text,
            episode.episode_number,
            chunk_size=settings.chunk_size_tokens,
            overlap=settings.chunk_overlap_tokens,
        )

        if not chunks:
            return AgentResult(success=False, error="No chunks produced from transcript")

        await self._report_progress(50, f"Embedding {len(chunks)} chunks...")

        # Generate embeddings (thread-pool so event loop stays free)
        import asyncio

        loop = asyncio.get_event_loop()
        chunks = await loop.run_in_executor(None, self._embed_chunks, chunks)

        # Extract keywords via simple TF approach
        keywords = self._extract_keywords(text, top_n=10)
        episode.keywords = keywords

        await self._report_progress(100, f"Chunked + embedded: {len(chunks)} chunks")
        logger.info(
            "Episode %d: %d chunks, keywords=%s",
            episode.episode_number,
            len(chunks),
            keywords[:5],
        )

        return AgentResult(
            success=True,
            data={"chunks": chunks, "episode": episode, "keywords": keywords},
        )

    def _strip_front_matter(self, text: str) -> str:
        if text.startswith("---"):
            end = text.find("---", 3)
            if end != -1:
                return text[end + 3 :].strip()
        return text

    def _split_into_chunks(
        self,
        text: str,
        episode_id: int,
        chunk_size: int = 750,
        overlap: int = 100,
    ) -> list[Chunk]:
        tokens = self._tokenizer.encode(text)
        chunks: list[Chunk] = []

        start = 0
        idx = 0
        while start < len(tokens):
            end = min(start + chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self._tokenizer.decode(chunk_tokens)

            # Try to extract timestamp range from chunk text
            timestamps = re.findall(r"\[(\d{2}:\d{2}:\d{2})\]", chunk_text)
            start_time = self._ts_to_seconds(timestamps[0]) if timestamps else None
            end_time = self._ts_to_seconds(timestamps[-1]) if timestamps else None

            chunks.append(
                Chunk(
                    id=f"ep{episode_id}_chunk{idx}",
                    episode_id=episode_id,
                    text=chunk_text,
                    chunk_index=idx,
                    start_time=start_time,
                    end_time=end_time,
                    token_count=len(chunk_tokens),
                    metadata={
                        "episode_id": episode_id,
                        "chunk_index": idx,
                    },
                )
            )
            idx += 1
            start = end - overlap if end < len(tokens) else end

        return chunks

    def _embed_chunks(self, chunks: list[Chunk]) -> list[Chunk]:
        """Embed chunks using local sentence-transformers model."""
        model = self._get_model()
        texts = [c.text for c in chunks]
        embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)

        for chunk, emb in zip(chunks, embeddings):
            chunk.embedding = emb.tolist()

        return chunks

    def _extract_keywords(self, text: str, top_n: int = 10) -> list[str]:
        # Simple term frequency approach
        # Remove timestamps
        clean = re.sub(r"\[\d{2}:\d{2}:\d{2}\]", "", text).lower()
        words = re.findall(r"[a-zæøå]{4,}", clean)

        # Norwegian stop words
        stop_words = {
            "denne", "dette", "disse", "slikt", "slike", "bare",
            "etter", "fordi", "sine", "også", "eller", "ikke",
            "noen", "alle", "mye", "mange", "helt", "veldig",
            "ganske", "litt", "godt", "hadde", "ville", "skulle",
            "kunne", "måtte", "fikk", "blitt", "komme", "gjøre",
            "over", "under", "mellom", "gjennom", "nå", "mens",
            "være", "med", "fra", "til", "som", "det", "den",
            "har", "hva", "hvem", "hvor", "når", "hvorfor",
            "hvordan", "skal", "kan", "vil", "blir", "ble",
            "var", "for", "men", "selv", "seg", "sin", "sitt",
            "altså", "egentlig", "liksom", "sant", "tenker",
            "sier", "synes", "mener", "tror", "ting",
        }

        freq: dict[str, int] = {}
        for w in words:
            if w not in stop_words:
                freq[w] = freq.get(w, 0) + 1

        sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)
        return [w for w, _ in sorted_words[:top_n]]

    @staticmethod
    def _ts_to_seconds(ts: str) -> float:
        parts = ts.split(":")
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        return 0.0
