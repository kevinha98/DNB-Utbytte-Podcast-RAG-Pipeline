"""
Live pipeline progress watcher.
Usage:  python watch_pipeline.py [--target 580]
Polls manifest + storage dirs every 5 min and prints a live dashboard.
Tracks large-v3 vs small model transcripts.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

MANIFEST = Path("storage/manifest.json")
AUDIO_DIR = Path("storage/audio")
TRANSCRIPT_DIR = Path("storage/transcripts")
BAR_WIDTH = 38


def progress_bar(done: int, total: int) -> str:
    ratio = done / total if total else 0
    filled = int(ratio * BAR_WIDTH)
    bar = "\u2588" * filled + "\u2591" * (BAR_WIDTH - filled)
    return f"[{bar}] {ratio*100:5.1f}%  ({done}/{total})"


def count_ext(directory: Path, ext: str) -> int:
    if not directory.exists():
        return 0
    return sum(1 for f in directory.iterdir() if f.suffix == ext)


def read_manifest() -> dict:
    if not MANIFEST.exists():
        return {}
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def read_frontmatter_model(md_path: Path) -> str:
    """Read model: field from YAML frontmatter. Returns 'small' if absent."""
    try:
        text = md_path.read_text(encoding="utf-8", errors="replace")
        if not text.startswith("---"):
            return "small"
        end = text.find("---", 3)
        if end == -1:
            return "small"
        fm = text[3:end]
        m = re.search(r"^model:\s*(.+)$", fm, re.MULTILINE)
        return m.group(1).strip() if m else "small"
    except OSError:
        return "small"


def clear_screen() -> None:
    sys.stdout.write('\033[2J\033[H')
    sys.stdout.flush()


def get_done_episodes() -> set[int]:
    """Return set of episode numbers that have a completed .md transcript."""
    if not TRANSCRIPT_DIR.exists():
        return set()
    nums = set()
    for f in TRANSCRIPT_DIR.iterdir():
        if f.suffix == ".md":
            try:
                nums.add(int(f.name.split("_")[0]))
            except ValueError:
                pass
    return nums


def count_models(start: int | None = None, end: int | None = None) -> dict[str, int]:
    """Count transcripts by model from frontmatter, optionally filtered by episode range."""
    counts = {"large-v3": 0, "small": 0, "other": 0}
    if not TRANSCRIPT_DIR.exists():
        return counts
    for f in TRANSCRIPT_DIR.iterdir():
        if f.suffix == ".md":
            try:
                ep = int(f.name.split("_")[0])
            except ValueError:
                continue
            if start is not None and ep < start:
                continue
            if end is not None and ep > end:
                continue
            model = read_frontmatter_model(f)
            if model == "large-v3":
                counts["large-v3"] += 1
            elif model == "small":
                counts["small"] += 1
            else:
                counts["other"] += 1
    return counts


def get_recent_errors(n: int = 5) -> list[str]:
    log_path = Path("pipeline.log")
    if not log_path.exists():
        return []
    errors = []
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.rstrip()
                if "ERROR" in line or "Exception" in line or "Worker exited" in line or "Traceback" in line:
                    errors.append(line[-120:])
    except OSError:
        pass
    return errors[-n:]


def get_failed_count() -> int:
    log_path = Path("pipeline.log")
    if not log_path.exists():
        return 0
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            return sum(
                1 for line in f
                if ("timed out" in line or "skipping episode" in line.lower())
                and "orchestrator" in line.lower()
            )
    except OSError:
        return 0


def get_active_workers() -> list[dict]:
    """Return info about currently running Whisper worker subprocesses."""
    import re as _re
    workers = []
    try:
        import psutil
        for proc in psutil.process_iter(["pid", "cmdline", "create_time", "memory_info"]):
            try:
                cmd = " ".join(proc.info["cmdline"] or [])
                # Worker scripts pass the audio path as a positional argument
                # Only match processes that have an audio file path AND are the
                # actual whisper worker (large RAM), not the orchestrator
                if "storage\\audio\\" not in cmd and "storage/audio/" not in cmd:
                    continue
                ep_match = _re.search(r'audio[/\\](\d+)_[^"\']+\.mp3', cmd)
                if not ep_match:
                    continue
                # Skip low-RAM processes (orchestrator/pipeline, not workers)
                mem = proc.info["memory_info"]
                if not mem or mem.rss < 500 * 1024 * 1024:  # < 500 MB = not a loaded model
                    continue
                ep_num = int(ep_match.group(1))
                # File size
                mp3_match = _re.search(r'audio[/\\](\d+_[^"\']+\.mp3)', cmd)
                size_mb = 0
                if mp3_match:
                    mp3_path = AUDIO_DIR / mp3_match.group(1)
                    if mp3_path.exists():
                        size_mb = round(mp3_path.stat().st_size / 1_048_576, 0)
                wall_min = round((time.time() - proc.info["create_time"]) / 60, 1)
                eta_min = round(size_mb * 3.5 - wall_min, 0)
                ram_mb = round(proc.info["memory_info"].rss / 1_048_576, 0) if proc.info["memory_info"] else 0
                workers.append({"ep": ep_num, "wall_min": wall_min, "size_mb": int(size_mb), "eta_min": eta_min, "ram_mb": int(ram_mb)})
            except (psutil.NoSuchProcess, psutil.AccessDenied, Exception):
                pass
    except ImportError:
        pass
    return sorted(workers, key=lambda x: x["ep"], reverse=True)


def render(target: int, start_ts: float, samples: list, completion_log: list,
           ep_start: int | None = None, ep_end: int | None = None) -> list:
    transcripts = count_ext(TRANSCRIPT_DIR, ".md")
    models = count_models(ep_start, ep_end)
    failed = get_failed_count()
    recent_errors = get_recent_errors(3)
    workers = get_active_workers()
    now = time.time()

    large_v3 = models["large-v3"]
    small = models["small"]

    range_label = ""
    if ep_start is not None or ep_end is not None:
        range_label = f"  (eps {ep_start or '?'}–{ep_end or '?'})"
        transcripts_label = f"Filtered transcripts:{range_label}"
    else:
        transcripts_label = "Total transcripts:"

    # Record sample
    samples.append((now, large_v3))

    # Speed based on large-v3 count growth
    speed = 0.0
    for i in range(len(samples) - 2, -1, -1):
        t0, d0 = samples[i]
        dt = now - t0
        delta = large_v3 - d0
        if delta > 0 and dt > 0:
            speed = delta / dt * 60
            break

    if speed == 0.0 and len(samples) >= 2:
        t0, d0 = samples[0]
        dt = now - t0
        delta = large_v3 - d0
        if delta > 0 and dt > 0:
            speed = delta / dt * 60

    remaining = max(0, target - large_v3)
    if speed > 0:
        eta_s = remaining / speed * 60
        h, r = divmod(int(eta_s), 3600)
        m, s = divmod(r, 60)
        eta_str = f"{h}h {m:02d}m" if h else (f"{m}m {s:02d}s" if m else f"{s}s")
    else:
        eta_str = "waiting for first episode..."

    te = now - start_ts
    te_h, te_r = divmod(int(te), 3600)
    te_m, te_s = divmod(te_r, 60)
    el_str = f"{te_h}h {te_m:02d}m {te_s:02d}s" if te_h else f"{te_m}m {te_s:02d}s"

    log_lines = ["  ── Recently completed ─────────────────────────"]
    if completion_log:
        for entry in completion_log[-15:]:
            log_lines.append(f"  {entry}")
    else:
        log_lines.append("  (none yet this session)")

    # Active workers section
    worker_lines = ["  ── Active workers ──────────────────────────────"]
    if workers:
        worker_lines.append(f"  {'EP':<6} {'Running':>9}  {'File':>7}  {'ETA':>8}  {'RAM':>7}")
        worker_lines.append(f"  {'──':<6} {'───────':>9}  {'────':>7}  {'───':>8}  {'───':>7}")
        for w in workers:
            eta_str = f"~{int(w['eta_min'])} min" if w['eta_min'] > 0 else f"+{int(-w['eta_min'])} min over"
            worker_lines.append(f"  {w['ep']:<6} {w['wall_min']:>7.1f}m  {w['size_mb']:>5}MB  {eta_str:>8}  {w['ram_mb']:>5}MB")
    else:
        worker_lines.append("  (none detected)")

    lines = [
        "+==============================================+",
        "|   UTBYTTE-AGENTEN  *  Transcription Progress |",
        "+==============================================+",
        "",
        f"  {transcripts_label}",
        f"    large-v3:         {large_v3:>4}",
        f"    small:            {small:>4}  (to be upgraded)",
        f"  Failed:             {failed:>4}",
        "",
        f"  large-v3  {progress_bar(large_v3, target)}",
        "",
        f"  Speed:   {speed:5.2f} eps/min",
        f"  Elapsed: {el_str:<22}  ETA: {eta_str}",
        "",
    ] + worker_lines + [
        "",
    ] + log_lines + [
        "",
        "  ── Recent errors ────────────────────────────────",
    ] + (
        [f"  {e}" for e in recent_errors] if recent_errors else ["  (none)"]
    ) + [
        "",
        f"  Refreshed: {datetime.now().strftime('%H:%M:%S')}   Ctrl+C to quit",
    ]
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=580,
                        help="Target number of large-v3 transcripts (default: 580)")
    parser.add_argument("--start", type=int, default=None,
                        help="Only count episodes >= this number")
    parser.add_argument("--end", type=int, default=None,
                        help="Only count episodes <= this number")
    args = parser.parse_args()

    # When filtering by range, auto-set target to the range size
    if args.start is not None and args.end is not None:
        args.target = args.end - args.start + 1

    start_ts = time.time()
    samples = []
    completion_log: list[str] = []
    seen_eps = get_done_episodes()

    try:
        while True:
            current_eps = get_done_episodes()
            newly_done = sorted(current_eps - seen_eps)
            for ep in newly_done:
                ts = datetime.now().strftime("%H:%M:%S")
                matches = list(TRANSCRIPT_DIR.glob(f"{ep:03d}_*.md"))
                if matches:
                    model = read_frontmatter_model(matches[0])
                    title = matches[0].stem.split("_", 1)[1].replace("-", " ").title()
                    completion_log.append(f"[{ts}]  ep {ep:>3}  [{model}]  {title[:35]}")
                else:
                    completion_log.append(f"[{ts}]  ep {ep:>3}")
            seen_eps = current_eps

            lines = render(args.target, start_ts, samples, completion_log,
                          args.start, args.end)
            clear_screen()
            sys.stdout.write("\n".join(lines) + "\n")
            sys.stdout.flush()
            time.sleep(300)
    except KeyboardInterrupt:
        print("\n\nWatcher stopped.")


if __name__ == "__main__":
    main()
