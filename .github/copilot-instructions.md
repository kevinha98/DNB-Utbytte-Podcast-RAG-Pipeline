# Copilot Safety Rules for utbytte-agenten

## NON-NEGOTIABLE: Never destroy existing work

> **ABSOLUTE CONSTRAINT — NO EXCEPTIONS**
> You MUST NOT and MUST NEVER delete, overwrite, move, or truncate any file under
> `backend/storage/` — including `.mp3` audio files, `.jsonl`/`.md` transcripts,
> the ChromaDB index, and `manifest.json`.
> This applies regardless of the task, script, or command being run.
> There is no circumstance under which deleting storage files is acceptable.

These rules exist because a deploy script wiped all MP3s, the ChromaDB index, and the
Python venv. These data files are gitignored (intentionally large) and cannot be recovered
from git history once deleted.

---

## What must NEVER be deleted

| Path | Why it's precious |
|------|-------------------|
| `backend/storage/audio/` | 580 MP3 files; each takes ~90s to re-download |
| `backend/storage/chromadb/` | Vector DB index; takes hours to rebuild |
| `backend/storage/manifest.json` | Pipeline progress tracker |
| `backend/venv312/` | Python virtualenv; takes 10+ minutes to recreate |
| `backend/storage/transcripts/` | 580 transcripts; whisper large-v3 takes days |

**MUST NOT: Never run any delete/remove/rm/truncate command targeting `backend/storage/` or any of its contents, for any reason.** Always scope deletions narrowly (e.g. a specific temp folder, a specific file, the `out/` build directory).

---

## gh-pages deploys: use git worktree, NOT branch switch

**WRONG — deletes gitignored files:**
```powershell
git checkout gh-pages
Get-ChildItem $RepoRoot -Exclude ".git" | Remove-Item -Recurse -Force  # ← DESTROYS EVERYTHING
```

**RIGHT — use a separate worktree so main tree is never touched:**
```powershell
$wt = "$env:TEMP\utbytte-gh-pages-$(Get-Random)"
git worktree add $wt gh-pages
# copy out/ into $wt, commit, push from $wt
git worktree remove $wt --force
```

The `deploy-pages.ps1` script in this repo uses the worktree approach. Always use it.

---

## Ad-hoc / one-time scripts

Scripts like `retranscribe.py`, `reindex.py`, `redownload_audio.py`, `strip_disclaimers.py`,
`download_all.py` are one-time utility scripts. They **may** be deleted after use.

Core pipeline scripts (`watchdog.py`, `main.py`, `watch_pipeline.py`, agents/, api/, models/,
pipeline/) must NEVER be deleted.

---

## Before any destructive git operation

1. Run `git status` and identify what is staged/untracked
2. Verify no gitignored runtime data will be collateral damage
3. Audit: does this operate on a temp dir or the live repo root?

If in doubt, copy first to `$env:TEMP`, operate there, copy back.
