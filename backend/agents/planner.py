from __future__ import annotations

import logging
import re
from datetime import date, datetime

import feedparser

from agents.base import AgentMessage, AgentResult, BaseAgent
from config import settings
from models.episode import Episode

logger = logging.getLogger(__name__)


class PlannerAgent(BaseAgent):
    """Fetches and parses the podcast RSS feed into Episode objects."""

    def __init__(self) -> None:
        super().__init__("planner")

    async def run(self, message: AgentMessage) -> AgentResult:
        await self._report_progress(0, "Fetching RSS feed...")
        feed = feedparser.parse(settings.rss_feed_url)

        if feed.bozo and not feed.entries:
            return AgentResult(
                success=False,
                error=f"Failed to parse RSS feed: {feed.bozo_exception}",
            )

        episodes: list[Episode] = []
        for i, entry in enumerate(feed.entries):
            try:
                ep = self._parse_entry(entry, len(feed.entries) - i)
                episodes.append(ep)
            except Exception as exc:
                logger.warning("Skipping entry %s: %s", entry.get("title", "?"), exc)

            if (i + 1) % 10 == 0:
                await self._report_progress(
                    (i + 1) / len(feed.entries) * 100,
                    f"Parsed {i + 1}/{len(feed.entries)} entries",
                )

        # Sort by episode number ascending
        episodes.sort(key=lambda e: e.episode_number)
        await self._report_progress(100, f"Found {len(episodes)} episodes")

        logger.info("Planner found %d episodes", len(episodes))
        return AgentResult(success=True, data=episodes)

    def _parse_entry(self, entry: dict, fallback_num: int) -> Episode:
        title = entry.get("title", "Unknown")

        # Try to extract episode number from title or itunes metadata
        ep_num = self._extract_episode_number(entry, fallback_num)

        # Publish date
        pub_date = self._parse_date(entry)

        # Audio URL from enclosures
        audio_url = ""
        for link in entry.get("links", []):
            if link.get("type", "").startswith("audio/") or link.get("href", "").endswith((".mp3", ".m4a", ".mp4")):
                audio_url = link["href"]
                break
        if not audio_url:
            for enc in entry.get("enclosures", []):
                audio_url = enc.get("href", "")
                if audio_url:
                    break

        # Duration
        duration = entry.get("itunes_duration", "")
        if isinstance(duration, (int, float)):
            mins, secs = divmod(int(duration), 60)
            hours, mins = divmod(mins, 60)
            duration = f"{hours:02d}:{mins:02d}:{secs:02d}" if hours else f"{mins:02d}:{secs:02d}"

        # Description
        description = entry.get("summary", entry.get("description", ""))
        # Strip HTML tags
        description = re.sub(r"<[^>]+>", "", description).strip()

        # Episode page URL
        url = entry.get("link", "")

        return Episode(
            title=title,
            episode_number=ep_num,
            publish_date=pub_date,
            url=url,
            audio_url=audio_url,
            duration=duration,
            description=description[:500],
        )

    def _extract_episode_number(self, entry: dict, fallback: int) -> int:
        # Check itunes:episode tag
        itunes_ep = entry.get("itunes_episode")
        if itunes_ep:
            try:
                return int(itunes_ep)
            except (ValueError, TypeError):
                pass

        # Try to extract from title: "Episode 5", "Ep. 12", "#7", "5 –"
        title = entry.get("title", "")
        patterns = [
            r"[Ee]pisode\s*(\d+)",
            r"[Ee]p\.?\s*(\d+)",
            r"#(\d+)",
            r"^(\d+)\s*[–\-\:]",
        ]
        for pattern in patterns:
            m = re.search(pattern, title)
            if m:
                return int(m.group(1))

        return fallback

    def _parse_date(self, entry: dict) -> date:
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        if published:
            try:
                return date(published.tm_year, published.tm_mon, published.tm_mday)
            except Exception:
                pass
        # Fallback
        return date.today()
