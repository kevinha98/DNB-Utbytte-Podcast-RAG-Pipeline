from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from agents.base import AgentMessage, AgentResult
from models.episode import Episode

logger = logging.getLogger(__name__)


@dataclass
class PipelineProgress:
    total_episodes: int = 0
    completed: int = 0
    failed: int = 0
    current_step: str = "idle"
    errors: list[dict[str, Any]] = field(default_factory=list)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    @property
    def is_running(self) -> bool:
        return self.started_at is not None and self.finished_at is None

    def to_dict(self) -> dict:
        return {
            "total_episodes": self.total_episodes,
            "completed": self.completed,
            "failed": self.failed,
            "current_step": self.current_step,
            "errors": self.errors,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "is_running": self.is_running,
        }


class PipelineOrchestrator:
    """Orchestrates the full episode processing pipeline with parallel execution."""

    def __init__(
        self,
        planner,
        downloader,
        transcriber,
        chunker,
        database,
        max_concurrent: int = 3,
    ) -> None:
        self.planner = planner
        self.downloader = downloader
        self.transcriber = transcriber
        self.chunker = chunker
        self.database = database
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._dl_semaphore = asyncio.Semaphore(8)  # downloads are I/O-bound, allow more
        self.progress = PipelineProgress()
        self._progress_callbacks: list[Callable] = []
        self._manifest_path = Path("storage/manifest.json")

    def on_progress(self, callback: Callable) -> None:
        self._progress_callbacks.append(callback)

    async def _notify(self) -> None:
        for cb in self._progress_callbacks:
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(self.progress)
                else:
                    cb(self.progress)
            except Exception:
                pass

    def _load_manifest(self) -> dict[str, str]:
        if self._manifest_path.exists():
            return json.loads(self._manifest_path.read_text(encoding="utf-8-sig"))
        return {}

    def _save_manifest(self, manifest: dict[str, str]) -> None:
        self._manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self._manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    async def run_pipeline(
        self, max_episodes: int | None = None
    ) -> PipelineProgress:
        self.progress = PipelineProgress(started_at=datetime.utcnow())
        self.progress.current_step = "fetching_rss"
        await self._notify()

        # Step 1: Planner fetches episode list
        plan_result = await self.planner.execute(
            AgentMessage(sender="orchestrator", msg_type="plan", payload=None)
        )
        if not plan_result.success:
            self.progress.current_step = "error"
            self.progress.errors.append({"step": "plan", "error": plan_result.error})
            self.progress.finished_at = datetime.utcnow()
            return self.progress

        episodes: list[Episode] = plan_result.data
        if max_episodes:
            episodes = episodes[:max_episodes]

        manifest = self._load_manifest()
        all_unfinished = [
            ep for ep in episodes
            if manifest.get(str(ep.episode_number)) != "done"
        ]
        self.progress.total_episodes = len(all_unfinished)

        if not all_unfinished:
            logger.info("All episodes already processed.")
            self.progress.current_step = "done"
            self.progress.finished_at = datetime.utcnow()
            return self.progress

        # ── Phase 1: Download all audio ─────────────────────────────────────
        # Fast network I/O first — get all MP3s before starting slow CPU work.
        phase1 = [
            ep for ep in all_unfinished
            if manifest.get(str(ep.episode_number)) not in ("downloaded", "transcribed", "done")
        ]
        if phase1:
            logger.info("Phase 1 — downloading %d episodes...", len(phase1))
            self.progress.current_step = "downloading"
            await self._notify()
            tasks = [self._process_episode(ep, manifest, phase=1) for ep in phase1]
            await asyncio.gather(*tasks, return_exceptions=True)

        # ── Phase 2: Transcribe all audio ──────────────────────────────────
        manifest = self._load_manifest()
        phase2 = [
            ep for ep in episodes
            if manifest.get(str(ep.episode_number)) in ("downloaded",)
        ]
        phase2.sort(key=lambda ep: ep.episode_number, reverse=True)
        if phase2:
            logger.info("Phase 2 — transcribing %d episodes...", len(phase2))
            self.progress.current_step = "transcribing"
            await self._notify()
            tasks = [self._process_episode(ep, manifest, phase=2) for ep in phase2]
            await asyncio.gather(*tasks, return_exceptions=True)

        # ── Phase 3: Embed + Store ──────────────────────────────────────────
        manifest = self._load_manifest()
        phase3 = [
            ep for ep in episodes
            if manifest.get(str(ep.episode_number)) == "transcribed"
        ]
        if phase3:
            logger.info("Phase 3 — embedding %d episodes...", len(phase3))
            # Pre-warm model ONCE before spawning concurrent tasks.
            logger.info("Pre-warming embedding model...")
            from agents.chunker import _get_shared_model
            _get_shared_model()
            logger.info("Embedding model ready.")
            self.progress.current_step = "embedding"
            await self._notify()
            tasks = [self._process_episode(ep, manifest, phase=3) for ep in phase3]
            await asyncio.gather(*tasks, return_exceptions=True)

        self.progress.current_step = "done"
        self.progress.finished_at = datetime.utcnow()
        await self._notify()
        return self.progress

    async def _process_episode(
        self, episode: Episode, manifest: dict[str, str], phase: int = 0
    ) -> None:
        try:
            await self._process_episode_inner(episode, manifest, phase=phase)
        except Exception as exc:
            logger.exception(
                "Unhandled crash in episode %d (%s): %s",
                episode.episode_number, episode.title, exc,
            )
            self.progress.failed += 1
            self.progress.errors.append(
                {"episode": episode.episode_number, "step": "unknown", "error": str(exc)}
            )
            await self._notify()

    async def _process_episode_inner(
        self, episode: Episode, manifest: dict[str, str], phase: int = 0
    ) -> None:
        # Phase 1 (download) uses a wider semaphore — I/O bound, not CPU bound
        sem = self._dl_semaphore if phase == 1 else self._semaphore
        async with sem:
            ep_num = episode.episode_number
            logger.info("Processing episode %d (phase %d): %s", ep_num, phase, episode.title)

            if phase == 1:
                # Download only
                steps = [
                    ("download", self.downloader, 300),
                ]
                done_status = "downloaded"
            elif phase == 2:
                # Transcribe only (audio already on disk)
                steps = [
                    ("transcribe", self.transcriber, 25200),
                ]
                done_status = "transcribed"
            elif phase == 3:
                # Embed + store (transcript already on disk)
                steps = [
                    ("chunk_embed", self.chunker,  120),
                    ("store",       self.database,  60),
                ]
                done_status = "done"
            else:
                # Legacy / single-pass (all four steps)
                steps = [
                    ("download",    self.downloader,  300),
                    ("transcribe",  self.transcriber, 25200),
                    ("chunk_embed", self.chunker,     120),
                    ("store",       self.database,     60),
                ]
                done_status = "done"

            chunker_result_data = None  # Hold chunker output for database agent

            for step_name, agent, timeout_s in steps:
                for attempt in range(2):  # max 2 attempts
                    # Database agent needs the full chunker output (chunks + episode)
                    if step_name == "store" and chunker_result_data is not None:
                        payload = chunker_result_data
                    else:
                        payload = episode

                    try:
                        result = await asyncio.wait_for(
                            agent.execute(
                                AgentMessage(
                                    sender="orchestrator",
                                    msg_type=step_name,
                                    payload=payload,
                                )
                            ),
                            timeout=timeout_s,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Episode %d step '%s' timed out after %ds — skipping episode.",
                            ep_num, step_name, timeout_s,
                        )
                        self.progress.failed += 1
                        self.progress.errors.append(
                            {"episode": ep_num, "step": step_name, "error": f"timeout after {timeout_s}s"}
                        )
                        await self._notify()
                        return
                    if result.success:
                        # Update episode with any data returned by the agent
                        if isinstance(result.data, Episode):
                            episode = result.data
                        elif isinstance(result.data, dict):
                            if step_name == "chunk_embed":
                                chunker_result_data = result.data
                            if "episode" in result.data and isinstance(result.data["episode"], Episode):
                                episode = result.data["episode"]
                            else:
                                for k, v in result.data.items():
                                    if hasattr(episode, k):
                                        setattr(episode, k, v)
                        break
                    else:
                        if attempt == 1:
                            self.progress.failed += 1
                            self.progress.errors.append(
                                {
                                    "episode": ep_num,
                                    "step": step_name,
                                    "error": result.error,
                                }
                            )
                            await self._notify()
                            return  # Skip remaining steps for this episode
                        logger.warning(
                            "Episode %d step %s failed (attempt %d), retrying...",
                            ep_num,
                            step_name,
                            attempt + 1,
                        )
                        await asyncio.sleep(1)

            # Mark episode progress in manifest
            manifest[str(ep_num)] = done_status
            self._save_manifest(manifest)
            if done_status == "done":
                self.progress.completed += 1
                await self._notify()
            logger.info("Episode %d — %s.", ep_num, done_status)
