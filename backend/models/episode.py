from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date


@dataclass
class Episode:
    title: str
    episode_number: int
    publish_date: date
    url: str
    audio_url: str
    duration: str = ""
    description: str = ""
    audio_path: str | None = None
    transcript_path: str | None = None
    keywords: list[str] = field(default_factory=list)
    status: str = "pending"  # pending | downloaded | transcribed | embedded | done

    @property
    def slug(self) -> str:
        safe = "".join(c if c.isalnum() or c in "-_ " else "" for c in self.title)
        slug = safe.strip().replace(" ", "-").lower()
        return re.sub(r"-{2,}", "-", slug)  # collapse ---  →  -

    @property
    def audio_filename(self) -> str:
        return f"{self.episode_number:03d}_{self.slug}.mp3"

    @property
    def transcript_filename(self) -> str:
        return f"{self.episode_number:03d}_{self.slug}.md"

    @property
    def jsonl_filename(self) -> str:
        return f"{self.episode_number:03d}_{self.slug}.jsonl"
