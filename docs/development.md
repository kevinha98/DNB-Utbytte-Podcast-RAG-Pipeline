# Development Guide

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.12 | `venv312/` (do not upgrade to 3.13 — torch/whisper incompatibilities) |
| Node.js | 20+ | For the Next.js frontend |
| ffmpeg | any | Required by faster-whisper for audio processing |
| uv | latest | Fast Python package installer (`pip install uv`) |
| Ollama | latest | Only for local LLM (optional if using Gemini) |

---

## Local Setup

```bash
# 1. Clone
git clone git@github.com:kevinha98/DNB-Utbytte-Podcast-RAG-Pipeline.git
cd DNB-Utbytte-Podcast-RAG-Pipeline

# 2. Configure environment
cp .env.example .env
# Edit .env:
#   LLM_API_KEY=your-gemini-key   (or "ollama" for local)
#   LLM_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
#   LLM_MODEL=gemini-2.0-flash
#   FRONTEND_URL=http://localhost:3002

# 3. Backend — Python virtualenv
cd backend
python -m venv venv312
venv312\Scripts\activate          # Windows
source venv312/bin/activate        # macOS/Linux
pip install uv
uv pip install -r requirements.txt

# 4. Run ingestion pipeline (optional — transcripts are committed)
python main.py                     # downloads + transcribes new episodes

# 5. Start backend API
uvicorn api.main:app --reload --port 8000

# 6. Frontend
cd ../frontend
npm install
npm run dev                        # starts on http://localhost:3002
```

The frontend auto-connects to `http://localhost:8000` by default. Change `NEXT_PUBLIC_API_URL` in `.env.local` to point to a remote backend.

---

## Project Structure

```
utbytte-agenten/
├── backend/
│   ├── agents/          # Six pipeline agents (BaseAgent subclasses)
│   ├── api/             # FastAPI app, schemas, route handlers
│   ├── models/          # Pydantic dataclasses: Episode, Chunk
│   ├── pipeline/        # Async orchestrator
│   ├── storage/
│   │   ├── transcripts/ # Committed: Whisper .jsonl + .md per episode
│   │   ├── audio/       # Gitignored: downloaded MP3s
│   │   └── chromadb/    # Gitignored: vector store (rebuild with pipeline)
│   ├── config.py        # pydantic-settings: all env vars
│   └── main.py          # CLI: python main.py [--from-episode N]
├── frontend/
│   └── src/
│       ├── app/         # Next.js App Router pages
│       ├── components/  # React components
│       └── lib/         # API client, utilities
└── docs/                # This documentation
```

---

## Adding a New Agent

All agents extend `BaseAgent` in `agents/base.py`:

```python
from agents.base import BaseAgent
from models.episode import Episode

class MyAgent(BaseAgent):
    """One-line description of what this agent does."""

    async def run(self, episode: Episode) -> Episode:
        self.log(f"Processing {episode.title}")
        # ... your logic ...
        return episode
```

Then register the agent in `pipeline/orchestrator.py`:

```python
from agents.my_agent import MyAgent

# In PipelineOrchestrator.__init__:
self.my_agent = MyAgent(self.settings)

# In run_episode():
episode = await self.my_agent.run(episode)
```

---

## API Reference

Base URL: `http://localhost:8000`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/episodes` | List all episodes |
| `GET` | `/api/episodes/{id}` | Get episode details |
| `POST` | `/api/pipeline/run` | Trigger ingestion pipeline |
| `POST` | `/api/qa/ask` | Ask a question (RAG) |
| `GET` | `/api/topics` | List extracted topics |

Interactive docs available at `http://localhost:8000/docs` (Swagger UI).

---

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CUDA out of memory` on transcription | Whisper model too large | Set `WHISPER_MODEL=small` in `.env` |
| `Connection refused` on QA requests | Backend not running | Start backend with `uvicorn api.main:app --port 8000` |
| `CORS error` in browser | `FRONTEND_URL` mismatch | Set `FRONTEND_URL=http://localhost:3002` in `.env` |
| ChromaDB empty after reinstall | Vector store gitignored | Re-run `python main.py` (transcripts are committed, fast) |
| `ffmpeg not found` | ffmpeg missing from PATH | Install ffmpeg and ensure it's on PATH |
| `ModuleNotFoundError: sentence_transformers` | venv not activated | Run `venv312\Scripts\activate` first |

---

## Running Tests

```bash
cd backend
pytest                             # run all tests
pytest tests/test_qa.py -v         # run specific test file
pytest --cov=agents --cov-report=term-missing  # with coverage
```

---

## Code Style

- Python: [Black](https://github.com/psf/black) formatter, [Ruff](https://docs.astral.sh/ruff/) linter
- TypeScript: ESLint + Prettier (configured in `frontend/`)
- Commit messages: `type: description` (e.g. `feat: add topic search endpoint`)
