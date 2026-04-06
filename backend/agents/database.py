from __future__ import annotations

import logging

import chromadb

from agents.base import AgentMessage, AgentResult, BaseAgent
from config import settings
from models.chunk import Chunk
from models.episode import Episode

logger = logging.getLogger(__name__)


class DatabaseAgent(BaseAgent):
    """Stores episode chunks + embeddings in ChromaDB."""

    def __init__(self) -> None:
        super().__init__("database")
        self._client: chromadb.PersistentClient | None = None
        self._collection = None

    def _get_collection(self):
        if self._collection is None:
            self._client = chromadb.PersistentClient(
                path=settings.chroma_persist_dir
            )
            self._collection = self._client.get_or_create_collection(
                name="utbytte_episodes",
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    async def run(self, message: AgentMessage) -> AgentResult:
        payload = message.payload

        # If payload is dict with chunks (from chunker agent)
        if isinstance(payload, dict) and "chunks" in payload:
            chunks: list[Chunk] = payload["chunks"]
            episode: Episode = payload.get("episode", payload)
        elif isinstance(payload, Episode):
            # Store step called directly — need chunks from message metadata
            chunks = message.metadata.get("chunks", [])
            episode = payload
        else:
            return AgentResult(success=False, error="Invalid payload for database agent")

        if not chunks:
            return AgentResult(success=False, error="No chunks to store")

        await self._report_progress(0, f"Storing {len(chunks)} chunks...")

        import asyncio

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._upsert_chunks, chunks, episode)

        if result:
            return AgentResult(success=False, error=result)

        episode.status = "embedded"
        await self._report_progress(100, f"Stored {len(chunks)} chunks in ChromaDB")
        logger.info("Stored %d chunks for episode %d", len(chunks), episode.episode_number)

        return AgentResult(success=True, data=episode)

    def _upsert_chunks(self, chunks: list[Chunk], episode: Episode) -> str | None:
        """Upsert chunks into ChromaDB. Returns error string or None on success."""
        try:
            collection = self._get_collection()

            ids = [c.id for c in chunks]
            documents = [c.text for c in chunks]
            embeddings = [c.embedding for c in chunks]
            metadatas = [
                {
                    "episode_number": episode.episode_number,
                    "title": episode.title,
                    "date": episode.publish_date.isoformat(),
                    "chunk_index": c.chunk_index,
                    "start_time": c.start_time or 0,
                    "end_time": c.end_time or 0,
                    "url": episode.url,
                }
                for c in chunks
            ]

            collection.upsert(
                ids=ids,
                documents=documents,
                embeddings=embeddings,
                metadatas=metadatas,
            )
            return None

        except Exception as exc:
            return f"ChromaDB upsert failed: {exc}"

    def query(
        self,
        query_embedding: list[float],
        n_results: int = 5,
        where: dict | None = None,
    ) -> dict:
        """Query ChromaDB for similar chunks."""
        collection = self._get_collection()
        kwargs = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where
        return collection.query(**kwargs)
