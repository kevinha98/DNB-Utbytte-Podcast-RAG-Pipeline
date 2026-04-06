from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Chunk:
    id: str
    episode_id: int
    text: str
    chunk_index: int
    start_time: float | None = None
    end_time: float | None = None
    token_count: int = 0
    embedding: list[float] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
