from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import yt_dlp

from agents.base import AgentMessage, AgentResult, BaseAgent
from config import settings
from models.episode import Episode

logger = logging.getLogger(__name__)


class DownloaderAgent(BaseAgent):
    """Downloads podcast audio files via yt-dlp (handles Acast CDN auth)."""

    def __init__(self) -> None:
        super().__init__("downloader")

    async def run(self, message: AgentMessage) -> AgentResult:
        episode: Episode = message.payload
        if not episode.url and not episode.audio_url:
            return AgentResult(success=False, error="No URL for episode")

        out_dir = Path(settings.audio_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / episode.audio_filename

        # Skip if already downloaded
        if out_path.exists() and out_path.stat().st_size > 0:
            logger.info("Audio already exists: %s", out_path)
            episode.audio_path = str(out_path)
            episode.status = "downloaded"
            return AgentResult(success=True, data=episode)

        await self._report_progress(0, f"Downloading {episode.title}...")

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, self._download_with_ytdlp, episode.url or episode.audio_url, str(out_path)
            )

            if not out_path.exists():
                # yt-dlp may have saved with a different extension (e.g. .m4a)
                stem = out_path.stem
                parent = out_path.parent
                candidates = list(parent.glob(f"{stem}.*"))
                if candidates:
                    out_path = candidates[0]
                else:
                    return AgentResult(success=False, error="yt-dlp download produced no file")

            episode.audio_path = str(out_path)
            episode.status = "downloaded"
            size_mb = out_path.stat().st_size / (1024 * 1024)
            await self._report_progress(100, f"Downloaded {size_mb:.1f}MB")
            logger.info("Downloaded episode %d: %.1fMB", episode.episode_number, size_mb)

            return AgentResult(success=True, data=episode)

        except Exception as exc:
            # Clean up partial file and any leftover .part files
            for p in [out_path, out_path.with_suffix(".part")]:
                if p.exists():
                    p.unlink(missing_ok=True)
            # Also clean up any *.mp3.part / *.m4a.part in audio dir
            for part in out_path.parent.glob(f"{out_path.stem}*.part"):
                part.unlink(missing_ok=True)
            return AgentResult(success=False, error=f"Download failed: {exc}")

    def _download_with_ytdlp(self, url: str, output_path: str) -> None:
        """Download audio using yt-dlp (synchronous, run in executor)."""
        # Remove extension since yt-dlp adds it
        out_template = output_path.rsplit(".", 1)[0] if "." in output_path else output_path

        # Use preferred:mp3 format selection so yt-dlp picks direct mp3 streams
        # without needing FFmpeg for conversion. If FFmpeg is available it will
        # also handle container remuxing, but we don't require it.
        # nopart=True writes directly to final filename avoiding WinError 32
        # rename-race with Windows Defender / concurrent downloads.
        opts = {
            "outtmpl": out_template + ".%(ext)s",
            "format": "bestaudio[ext=mp3]/bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "nopart": True,
            "nocontinue": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
