"""
Pipeline watchdog — auto-restarts the pipeline if it stalls.

A stall is detected when no new transcript (.md) files appear for STALL_MINUTES.
Runs forever until Ctrl+C. Logs all events to watchdog.log.

Usage:  python watchdog.py
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import psutil
    _PSUTIL = True
except ImportError:
    _PSUTIL = False

# ── Config ────────────────────────────────────────────────────────────────────
TRANSCRIPT_DIR   = Path("storage/transcripts")
STALL_MINUTES    = 240         # restart if no new .md in this many minutes (240 for large-v3 on CPU; was 90)
CHECK_INTERVAL_S = 60          # how often to poll
OOM_RAM_MB       = 20000       # kill pipeline if process tree RSS exceeds this (MB)
PYTHON           = str(Path(__file__).parent / "venv312" / "Scripts" / "python.exe")
PIPELINE_CMD     = [PYTHON, "main.py", "pipeline"]
LOG_FILE         = Path("watchdog.log")
PIPELINE_LOG     = Path(__file__).parent / "pipeline.log"
PIPELINE_ERR_LOG = Path(__file__).parent / "pipeline_err.log"
# ──────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [watchdog] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)


def count_transcripts() -> int:
    if not TRANSCRIPT_DIR.exists():
        return 0
    return sum(1 for f in TRANSCRIPT_DIR.iterdir() if f.suffix == ".md")


def latest_transcript_time() -> float:
    """Return mtime of the most recently modified .md file, or 0."""
    if not TRANSCRIPT_DIR.exists():
        return 0.0
    mtimes = [f.stat().st_mtime for f in TRANSCRIPT_DIR.iterdir() if f.suffix == ".md"]
    return max(mtimes) if mtimes else 0.0


def latest_activity_time() -> float:
    """Return the most recent activity time across: new transcripts, pipeline.log,
    and pipeline_err.log. This prevents false-stall restarts regardless of how
    the pipeline was launched (watchdog vs manual Start-Process)."""
    times = [latest_transcript_time()]
    for log_path in (PIPELINE_LOG, PIPELINE_ERR_LOG):
        if log_path.exists():
            times.append(log_path.stat().st_mtime)
    return max(t for t in times if t > 0) if any(t > 0 for t in times) else 0.0


def start_pipeline() -> subprocess.Popen:
    log.info("Starting pipeline: %s", " ".join(PIPELINE_CMD))
    out_fh = open(PIPELINE_LOG,     "a", encoding="utf-8")
    err_fh = open(PIPELINE_ERR_LOG, "a", encoding="utf-8")
    proc = subprocess.Popen(
        PIPELINE_CMD,
        cwd=Path(__file__).parent,
        stdout=out_fh,
        stderr=err_fh,
        env={**os.environ, "PYTHONUTF8": "1"},
    )
    log.info("Pipeline started (PID %d) — stdout→%s, stderr→%s",
             proc.pid, PIPELINE_LOG.name, PIPELINE_ERR_LOG.name)
    return proc


def main() -> None:
    log.info("Watchdog started  (stall threshold: %d min)", STALL_MINUTES)
    proc = start_pipeline()

    restarts = 0
    last_count = count_transcripts()
    last_new   = time.time()

    try:
        while True:
            time.sleep(CHECK_INTERVAL_S)

            current_count = count_transcripts()
            alive         = proc.poll() is None
            stale_s       = time.time() - latest_activity_time()
            stale_min     = stale_s / 60

            log.info(
                "Transcripts: %d | Pipeline alive: %s | Last activity: %.1f min ago",
                current_count, alive, stale_min,
            )

            if current_count > last_count:
                last_count = current_count
                last_new   = time.time()
            # Also reset stall timer on pipeline.log activity
            elif PIPELINE_LOG.exists() and (time.time() - PIPELINE_LOG.stat().st_mtime) < CHECK_INTERVAL_S * 2:
                last_new = time.time()

            # OOM guard — measure full process tree (pipeline + Whisper subprocs)
            oom = False
            if _PSUTIL and alive:
                try:
                    root = psutil.Process(proc.pid)
                    children = root.children(recursive=True)
                    tree_mb = sum(
                        p.memory_info().rss for p in [root] + children
                        if p.is_running()
                    ) / 1024 / 1024
                    if tree_mb > OOM_RAM_MB:
                        log.warning("Pipeline OOM (%.0f MB tree > %d MB limit) — killing", tree_mb, OOM_RAM_MB)
                        oom = True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            # Clean exit (rc=0) — check if truly done, otherwise restart
            if not alive and proc.returncode == 0:
                if current_count >= 579:
                    log.info("Pipeline exited cleanly with all 579 transcripts. Done!")
                    break
                log.warning("Pipeline exited cleanly (rc=0) but only %d/579 transcripts — restarting", current_count)
                restarts += 1
                proc = start_pipeline()
                last_new = time.time()
                continue

            # Stall = no pipeline.log activity AND no new transcripts
            stalled = stale_min > STALL_MINUTES
            crashed = (not alive) and proc.returncode not in (0, None)

            if stalled or crashed or oom:
                reason = "OOM" if oom else ("stalled" if stalled else f"crashed (rc={proc.returncode})")
                restarts += 1
                log.warning(
                    "Pipeline %s after %.1f min with no new transcripts — restarting (restart #%d)",
                    reason, stale_min, restarts,
                )
                if alive:
                    if _PSUTIL:
                        try:
                            root = psutil.Process(proc.pid)
                            for child in root.children(recursive=True):
                                child.kill()
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
                    proc.kill()
                    proc.wait(timeout=10)
                # Kill ALL lingering python processes (zombie Whisper workers
                # from previous runs that survived prior kills)
                if _PSUTIL:
                    current_pid = os.getpid()
                    for p in psutil.process_iter(["pid", "name"]):
                        try:
                            pname = (p.info["name"] or "").lower()
                            if pname.startswith("python") and p.pid != current_pid:
                                p.kill()
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
                time.sleep(5)  # give OS time to reclaim memory
                proc = start_pipeline()
                last_new = time.time()

    except KeyboardInterrupt:
        log.info("Watchdog stopped by user.")
        if proc.poll() is None:
            proc.kill()


if __name__ == "__main__":
    main()
