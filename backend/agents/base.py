from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable

logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class AgentMessage:
    sender: str
    msg_type: str
    payload: Any
    metadata: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)


@dataclass
class AgentResult:
    success: bool
    data: Any = None
    error: str | None = None
    duration_seconds: float = 0.0


class BaseAgent(ABC):
    def __init__(self, name: str) -> None:
        self.name = name
        self.status = AgentStatus.IDLE
        self._progress_callbacks: list[Callable] = []

    @abstractmethod
    async def run(self, message: AgentMessage) -> AgentResult:
        ...

    async def execute(self, message: AgentMessage) -> AgentResult:
        self.status = AgentStatus.RUNNING
        start = asyncio.get_event_loop().time()
        try:
            result = await self.run(message)
            self.status = AgentStatus.DONE if result.success else AgentStatus.ERROR
            result.duration_seconds = asyncio.get_event_loop().time() - start
            if result.success:
                logger.info(
                    "%s finished in %.1fs (success=True)",
                    self.name,
                    result.duration_seconds,
                )
            else:
                logger.warning(
                    "%s finished in %.1fs (success=False) error=%s",
                    self.name,
                    result.duration_seconds,
                    result.error,
                )
            return result
        except Exception as exc:
            self.status = AgentStatus.ERROR
            duration = asyncio.get_event_loop().time() - start
            logger.exception("%s failed after %.1fs", self.name, duration)
            return AgentResult(success=False, error=str(exc), duration_seconds=duration)

    def on_progress(self, callback: Callable) -> None:
        self._progress_callbacks.append(callback)

    async def _report_progress(self, pct: float, detail: str = "") -> None:
        for cb in self._progress_callbacks:
            try:
                if asyncio.iscoroutinefunction(cb):
                    await cb(self.name, pct, detail)
                else:
                    cb(self.name, pct, detail)
            except Exception:
                pass
