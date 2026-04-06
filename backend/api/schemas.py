from __future__ import annotations

from datetime import date
from pydantic import BaseModel, Field


# --- Request schemas ---

class QARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    filters: QAFilters | None = None
    model: str | None = Field(None, pattern=r"^eu-(sonnet|opus)-[0-9.-]+$")
    use_web: bool = False
    user_id: str | None = Field(None, max_length=64)


class QAFilters(BaseModel):
    episode_numbers: list[int] | None = None
    date_from: str | None = None  # YYYY-MM-DD
    date_to: str | None = None


class PipelineStartRequest(BaseModel):
    max_episodes: int | None = Field(None, ge=1, le=500)


# --- Response schemas ---

class SourceReference(BaseModel):
    episode_number: int
    title: str
    date: str
    url: str
    relevant_text: str
    similarity: float


class QAResponse(BaseModel):
    answer: str
    sources: list[SourceReference]
    confidence: float


class EpisodeSummary(BaseModel):
    episode_number: int
    title: str
    date: str
    duration: str
    description: str
    keywords: list[str]
    status: str


class EpisodeDetail(BaseModel):
    episode_number: int
    title: str
    date: str
    duration: str
    description: str
    url: str
    keywords: list[str]
    transcript: str | None = None


class PipelineStatusResponse(BaseModel):
    total_episodes: int
    completed: int
    failed: int
    current_step: str
    errors: list[dict]
    started_at: str | None
    finished_at: str | None
    is_running: bool


class TopicEntry(BaseModel):
    episode_number: int
    title: str
    keywords: list[str]


class TopicsResponse(BaseModel):
    topics: list[TopicEntry]


class HealthResponse(BaseModel):
    status: str
    version: str


# Fix forward reference
QARequest.model_rebuild()
