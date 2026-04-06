from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

from api.schemas import TopicEntry, TopicsResponse
from config import settings

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("", response_model=TopicsResponse)
async def get_topics():
    """Return keywords per episode extracted during chunking."""
    transcript_dir = Path(settings.transcript_dir)
    if not transcript_dir.exists():
        return TopicsResponse(topics=[])

    import yaml

    topics = []
    for md_file in sorted(transcript_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        if not text.startswith("---"):
            continue
        end = text.find("---", 3)
        if end == -1:
            continue
        try:
            meta = yaml.safe_load(text[3:end])
        except Exception:
            continue
        if isinstance(meta, dict):
            topics.append(
                TopicEntry(
                    episode_number=meta.get("episode", 0),
                    title=meta.get("title", ""),
                    keywords=meta.get("keywords", []),
                )
            )

    topics.sort(key=lambda t: t.episode_number)
    return TopicsResponse(topics=topics)
