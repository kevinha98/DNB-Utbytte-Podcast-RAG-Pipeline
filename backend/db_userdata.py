"""SQLite persistence for user instructions, feedback, and global memory.

Database lives at backend/storage/userdata.db (on Railway persistent volume).
All functions are synchronous — call via run_in_executor from async routes.
"""
from __future__ import annotations

import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings

_DB_PATH: Path | None = None
_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def _db_path() -> Path:
    global _DB_PATH
    if _DB_PATH is None:
        _DB_PATH = Path(settings.storage_dir) / "userdata.db"
    return _DB_PATH


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema() -> None:
    """Create tables if they don't exist. Safe to call on every startup."""
    with _lock:
        conn = get_db()
        try:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS user_profiles (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS custom_instructions (
                    user_id TEXT PRIMARY KEY,
                    preset_tone TEXT,
                    preset_language TEXT,
                    preset_focus TEXT,
                    free_text TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS feedback (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    thumbs INTEGER NOT NULL,
                    correction TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
                CREATE INDEX IF NOT EXISTS idx_feedback_thumbs ON feedback(thumbs);

                CREATE TABLE IF NOT EXISTS global_memory (
                    id TEXT PRIMARY KEY,
                    pattern TEXT NOT NULL,
                    example_question TEXT,
                    example_correction TEXT,
                    score INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );
            """)
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# User helpers
# ---------------------------------------------------------------------------

def ensure_user(user_id: str) -> None:
    with _lock:
        conn = get_db()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO user_profiles(id, created_at) VALUES (?, ?)",
                (user_id, _now()),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Custom instructions
# ---------------------------------------------------------------------------

def get_instructions(user_id: str) -> dict[str, str | None]:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT preset_tone, preset_language, preset_focus, free_text "
            "FROM custom_instructions WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return {"preset_tone": None, "preset_language": None, "preset_focus": None, "free_text": None}
        return dict(row)
    finally:
        conn.close()


def save_instructions(
    user_id: str,
    preset_tone: str | None,
    preset_language: str | None,
    preset_focus: str | None,
    free_text: str | None,
) -> None:
    with _lock:
        conn = get_db()
        try:
            conn.execute(
                """INSERT INTO custom_instructions
                    (user_id, preset_tone, preset_language, preset_focus, free_text, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET
                     preset_tone = excluded.preset_tone,
                     preset_language = excluded.preset_language,
                     preset_focus = excluded.preset_focus,
                     free_text = excluded.free_text,
                     updated_at = excluded.updated_at""",
                (user_id, preset_tone, preset_language, preset_focus, free_text, _now()),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

def save_feedback(
    user_id: str,
    question: str,
    answer: str,
    thumbs: int,
    correction: str | None,
) -> str:
    """Save feedback and trigger aggregation every 10th submission. Returns the new id."""
    feedback_id = str(uuid.uuid4())
    with _lock:
        conn = get_db()
        try:
            conn.execute(
                """INSERT INTO feedback(id, user_id, question, answer, thumbs, correction, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (feedback_id, user_id, question, answer, thumbs, correction, _now()),
            )
            conn.commit()
            count = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        finally:
            conn.close()

    # Every 10 submissions, re-aggregate global memory
    if count % 10 == 0:
        aggregate_corrections()

    return feedback_id


def get_user_feedback(user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """All feedback for a user, newest first."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, question, answer, thumbs, correction, created_at "
            "FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_recent_corrections(user_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Thumbs-down corrections only, newest first — used for prompt injection."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT question, correction FROM feedback "
            "WHERE user_id = ? AND thumbs = 0 AND correction IS NOT NULL AND correction != '' "
            "ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_feedback(feedback_id: str, user_id: str) -> bool:
    """Delete a feedback entry. Returns True if a row was deleted."""
    with _lock:
        conn = get_db()
        try:
            cur = conn.execute(
                "DELETE FROM feedback WHERE id = ? AND user_id = ?",
                (feedback_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Global memory + aggregation
# ---------------------------------------------------------------------------

# In-memory cache: (patterns list, cached_at timestamp)
_global_cache: tuple[list[dict[str, Any]], float] | None = None
_CACHE_TTL_SECONDS = 300  # 5 minutes


def get_global_memory(limit: int = 10) -> list[dict[str, Any]]:
    """Return top global patterns, using a 5-min in-memory cache."""
    import time
    global _global_cache
    now = time.monotonic()
    if _global_cache is not None and (now - _global_cache[1]) < _CACHE_TTL_SECONDS:
        return _global_cache[0][:limit]

    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, pattern, example_question, example_correction, score "
            "FROM global_memory ORDER BY score DESC LIMIT ?",
            (limit,),
        ).fetchall()
        patterns = [dict(r) for r in rows]
    finally:
        conn.close()

    _global_cache = (patterns, now)
    return patterns[:limit]


def _invalidate_global_cache() -> None:
    global _global_cache
    _global_cache = None


def aggregate_corrections() -> None:
    """Keyword-overlap clustering of all thumbs-down corrections across all users.

    Patterns that appear for ≥ 2 distinct users are promoted to global_memory.
    Uses simple term overlap (no LLM calls needed).
    """
    import re

    stop_words = {
        "hva", "hvor", "hvordan", "hvilke", "hvem", "som", "med", "for", "om",
        "til", "fra", "den", "det", "de", "jeg", "du", "vi", "en", "et", "på",
        "i", "av", "er", "og", "eller", "kan", "vil", "skal", "ble", "blir",
        "har", "hadde", "ikke", "seg", "sin", "sine", "sitt", "etter", "under",
    }

    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, user_id, question, correction FROM feedback "
            "WHERE thumbs = 0 AND correction IS NOT NULL AND correction != ''"
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return

    def extract_terms(text: str) -> set[str]:
        return {
            t for t in re.findall(r"[a-zA-ZæøåÆØÅ]{3,}", text.lower())
            if t not in stop_words
        }

    # Group corrections by term overlap (≥ 2 shared significant terms)
    groups: list[dict[str, Any]] = []
    for row in rows:
        terms = extract_terms((row["question"] or "") + " " + (row["correction"] or ""))
        placed = False
        for group in groups:
            overlap = len(terms & group["terms"])
            if overlap >= 2:
                group["rows"].append(row)
                group["terms"] |= terms
                placed = True
                break
        if not placed:
            groups.append({"terms": terms, "rows": [row]})

    now_str = _now()
    with _lock:
        conn = get_db()
        try:
            for group in groups:
                unique_users = {r["user_id"] for r in group["rows"]}
                if len(unique_users) < 2:
                    continue  # need at least 2 distinct users

                # Build a pattern description from the most common correction
                corrections = [r["correction"] for r in group["rows"] if r["correction"]]
                if not corrections:
                    continue
                # Use the longest correction as the representative text
                best_correction = max(corrections, key=len)
                example_q = group["rows"][0]["question"]
                # Summarize terms as a pattern label
                top_terms = sorted(group["terms"], key=len, reverse=True)[:5]
                pattern = f"Tilbakemelding om: {', '.join(top_terms)}. Eks: {best_correction[:120]}"
                score = len(group["rows"])
                pattern_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, pattern[:80]))

                conn.execute(
                    """INSERT INTO global_memory(id, pattern, example_question, example_correction, score, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET
                         score = excluded.score,
                         updated_at = excluded.updated_at""",
                    (pattern_id, pattern, example_q, best_correction, score, now_str),
                )
            conn.commit()
        finally:
            conn.close()

    _invalidate_global_cache()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
