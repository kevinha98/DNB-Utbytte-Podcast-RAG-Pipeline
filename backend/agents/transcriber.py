from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from agents.base import AgentMessage, AgentResult, BaseAgent
from config import settings
from models.episode import Episode

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Disclaimer detection — these keywords appear in the standard end-of-episode
# legal disclaimer read aloud on every Utbytte episode. Whisper may garble the
# exact Norwegian spelling but these substrings survive reliably.
# ---------------------------------------------------------------------------
_DISCLAIMER_KEYWORDS = [
    "markedsf",               # markedsføring / markedsf*ringsmaterial
    "investeringsanbefaling",
    "investeringsr",          # investeringsrådgivning
    "direkte eller indirekte",
    "disklemer",              # disclaimer (garbled)
    "dnb.no",
    "juridisk, finansiell",
]

# ---------------------------------------------------------------------------
# Standalone worker script written to a temp .py and run with subprocess.run.
# It imports ONLY faster_whisper — never this package — so there is zero risk
# of the Windows ProcessPoolExecutor "__main__ re-spawn" bug that caused the
# pipeline to restart every ~60 s without completing a single episode.
# ---------------------------------------------------------------------------
_WORKER_SCRIPT = """\
import json, sys
from faster_whisper import WhisperModel

def run():
    audio_path, model_name, device, compute_type, initial_prompt, out_path = sys.argv[1:]
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, _ = model.transcribe(
        audio_path,
        language="no",
        beam_size=5,
        initial_prompt=initial_prompt or None,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    results = [
        {"start": s.start, "end": s.end, "text": s.text.strip()}
        for s in segments
    ]
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False)

if __name__ == "__main__":
    run()
"""


def _run_worker_subprocess(
    audio_path: str,
    whisper_model: str,
    whisper_device: str,
    whisper_compute_type: str,
    initial_prompt: str = "",
) -> list[dict]:
    """
    Writes the worker to a temp .py, runs it in an isolated subprocess,
    reads the JSON result back.  Called from a thread via run_in_executor
    so the asyncio event loop is never blocked.
    """
    # Write worker script
    wf = tempfile.NamedTemporaryFile(
        suffix=".py", delete=False, mode="w", encoding="utf-8"
    )
    wf.write(_WORKER_SCRIPT)
    wf.close()
    worker_path = wf.name

    # Output file
    jf = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    jf.close()
    out_path = jf.name

    try:
        proc = subprocess.run(
            [
                sys.executable, worker_path,
                audio_path, whisper_model, whisper_device, whisper_compute_type,
                initial_prompt, out_path,
            ],
            capture_output=True,
            text=True,
            timeout=21600,  # 6h — handles longest episodes on CPU with large-v3
        )
        if proc.returncode != 0:
            stderr_msg = (proc.stderr or "").strip()[-3000:]
            raise RuntimeError(
                f"Transcription worker exited {proc.returncode}.\n{stderr_msg}"
            )
        with open(out_path, encoding="utf-8") as f:
            return json.load(f)
    finally:
        for p in (worker_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


class TranscriberAgent(BaseAgent):
    """Transcribes podcast audio using faster-whisper (subprocess-isolated)."""

    def __init__(self) -> None:
        super().__init__("transcriber")

    async def run(self, message: AgentMessage) -> AgentResult:
        episode: Episode = message.payload

        audio_dir = Path(settings.audio_dir)

        # If audio_path not set (e.g. after pipeline restart), find the file on disk
        if not episode.audio_path:
            candidates = list(audio_dir.glob(f"{episode.episode_number:03d}_*"))
            if candidates:
                episode.audio_path = str(candidates[0])
            else:
                return AgentResult(success=False, error="No audio path — download first")

        audio_path = Path(episode.audio_path)
        if not audio_path.exists():
            # Try to locate by episode number as fallback
            candidates = list(audio_dir.glob(f"{episode.episode_number:03d}_*"))
            if candidates:
                audio_path = candidates[0]
                episode.audio_path = str(audio_path)
            else:
                return AgentResult(success=False, error=f"Audio file not found: {audio_path}")

        out_dir = Path(settings.transcript_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        md_path = out_dir / episode.transcript_filename
        jsonl_path = out_dir / episode.jsonl_filename

        # Skip only if already transcribed with the *current target model*.
        # If the file exists but was made with a different/older model, fall
        # through and re-transcribe — the new file will atomically replace it.
        if md_path.exists() and md_path.stat().st_size > 100:
            existing_model = self._read_frontmatter_model(md_path)
            if existing_model == settings.whisper_model:
                logger.info("Transcript already up-to-date (%s): %s", existing_model, md_path)
                episode.transcript_path = str(md_path)
                episode.status = "transcribed"
                return AgentResult(success=True, data=episode)
            logger.info(
                "Re-transcribing ep %d: existing model=%s, target=%s",
                episode.episode_number, existing_model, settings.whisper_model,
            )

        await self._report_progress(0, f"Transcribing {episode.title}...")

        import asyncio

        # Run in a thread so the asyncio event loop is never blocked.
        # subprocess.run in the thread spawns a clean worker — Whisper RAM
        # is freed when that worker exits.
        loop = asyncio.get_event_loop()
        try:
            segments_data = await loop.run_in_executor(
                None,
                _run_worker_subprocess,
                str(audio_path),
                settings.whisper_model,
                settings.whisper_device,
                settings.whisper_compute_type,
                settings.whisper_initial_prompt,
            )
        except Exception as exc:
            logger.exception(
                "Transcription failed for ep %d (%s): %s",
                episode.episode_number, audio_path, exc,
            )
            return AgentResult(success=False, error=str(exc))

        if not segments_data:
            return AgentResult(success=False, error="Transcription produced no segments")

        # Strip end-of-episode legal disclaimer before writing any output
        segments_data = self._strip_disclaimer(segments_data)

        # Write to temp files first, then atomically replace so the old
        # transcript is never lost if transcription fails partway through.
        # Use .with_name(...+".tmp") not .with_suffix(".tmp") — both .md and
        # .jsonl would otherwise collapse to the same stem+".tmp" path.
        tmp_md = md_path.with_name(md_path.name + ".tmp")
        tmp_jsonl = jsonl_path.with_name(jsonl_path.name + ".tmp")
        try:
            md_content = self._build_markdown(episode, segments_data)
            tmp_md.write_text(md_content, encoding="utf-8")

            with open(tmp_jsonl, "w", encoding="utf-8") as f:
                for i, seg in enumerate(segments_data):
                    line = {
                        "episode_id": episode.episode_number,
                        "segment_index": i,
                        "start": round(seg["start"], 2),
                        "end": round(seg["end"], 2),
                        "text": seg["text"],
                    }
                    f.write(json.dumps(line, ensure_ascii=False) + "\n")

            # Atomic replace — old files survive until this succeeds
            os.replace(tmp_md, md_path)
            os.replace(tmp_jsonl, jsonl_path)
        except Exception:
            for tmp in (tmp_md, tmp_jsonl):
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
            raise

        episode.transcript_path = str(md_path)
        episode.status = "transcribed"
        await self._report_progress(100, f"Transcribed {len(segments_data)} segments")
        logger.info(
            "Transcribed episode %d: %d segments", episode.episode_number, len(segments_data)
        )

        return AgentResult(success=True, data=episode)

    @staticmethod
    def _read_frontmatter_model(md_path: Path) -> str | None:
        """Return the 'model:' value from YAML frontmatter, or None if absent."""
        try:
            text = md_path.read_text(encoding="utf-8", errors="replace")
            if not text.startswith("---"):
                return None
            end = text.find("---", 3)
            if end == -1:
                return None
            m = re.search(r"^model:\s*(.+)$", text[3:end], re.MULTILINE)
            return m.group(1).strip() if m else None
        except OSError:
            return None

    def _strip_disclaimer(self, segments: list[dict]) -> list[dict]:
        """Remove the standard end-of-episode legal disclaimer.

        Scans the last 25 segments and truncates from the first one that
        contains a known disclaimer keyword. Both .md and .jsonl benefit.
        """
        if not segments:
            return segments
        window_start = max(0, len(segments) - 25)
        for i in range(window_start, len(segments)):
            text_lower = segments[i]["text"].lower()
            if any(kw in text_lower for kw in _DISCLAIMER_KEYWORDS):
                removed = len(segments) - i
                logger.debug("Stripped %d disclaimer segment(s) from episode", removed)
                return segments[:i]
        return segments

    def _build_markdown(self, episode: Episode, segments: list[dict]) -> str:
        lines = [
            "---",
            f'title: "{episode.title}"',
            f"episode: {episode.episode_number}",
            f"date: {episode.publish_date.isoformat()}",
            f'url: "{episode.url}"',
            f'duration: "{episode.duration}"',
            f"model: {settings.whisper_model}",
            "---",
            "",
        ]
        for seg in segments:
            ts = self._format_timestamp(seg["start"])
            lines.append(f"[{ts}] {seg['text']}")
            lines.append("")

        return "\n".join(lines)

    @staticmethod
    def _format_timestamp(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        return f"{h:02d}:{m:02d}:{s:02d}"
