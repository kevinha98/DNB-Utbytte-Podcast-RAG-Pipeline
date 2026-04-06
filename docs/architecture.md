# Architecture

## Overview

Utbytte Agenten is a two-pipeline system:

1. **Ingestion pipeline** — runs offline, processes podcast audio → ChromaDB
2. **Query pipeline** — runs at request time, answers questions via RAG

---

## Ingestion Pipeline

```
RSS feed
  │
  ▼
┌─────────────┐
│   Planner   │  Fetches feed, checks manifest, yields new episode URLs
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Downloader │  Downloads MP3 audio to backend/storage/audio/
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│   Transcriber   │  faster-whisper (model: small), outputs .jsonl + .md
└────────┬────────┘
         │
         ▼
┌─────────────┐
│   Chunker   │  Splits transcript into ~300-word chunks, generates
│             │  sentence-transformer embeddings (384-dim)
└──────┬──────┘
       │
       ▼
┌──────────────┐
│   Database   │  Upserts chunk vectors + metadata into ChromaDB
└──────────────┘
```

**Orchestration**: `backend/pipeline/orchestrator.py` runs agents sequentially per episode. The pipeline is idempotent — re-running skips already-processed episodes (manifest-gated).

---

## Query Pipeline (RAG)

```
User question (Norwegian text)
  │
  ▼
┌─────────────────────────────────┐
│  QA Agent: embed question       │  sentence-transformers → 384-dim vector
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  ChromaDB: cosine similarity    │  Returns top-5 most relevant chunks
│  search across all episodes     │  with metadata (episode, timestamp)
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  QA Agent: prompt construction  │  System prompt + context chunks +
│                                 │  user question (Norwegian)
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  LLM API (OpenAI-compatible)    │  Gemini Flash 2.0 / Ollama / Groq
│                                 │  Returns answer in Norwegian
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Response: answer + citations   │  Episode title, timestamp, relevance
└─────────────────────────────────┘
```

---

## Agent Components

| Agent | File | Responsibility |
|-------|------|----------------|
| `PlannerAgent` | `agents/planner.py` | Parse RSS, check manifest, yield new episodes |
| `DownloaderAgent` | `agents/downloader.py` | Download MP3 audio (async with progress tracking) |
| `TranscriberAgent` | `agents/transcriber.py` | Whisper transcription → `.jsonl` + `.md` |
| `ChunkerAgent` | `agents/chunker.py` | Text splitting + sentence-transformer embedding |
| `DatabaseAgent` | `agents/database.py` | ChromaDB upsert + query |
| `QAAgent` | `agents/qa.py` | End-to-end RAG: embed → retrieve → LLM → answer |

All agents extend `BaseAgent` (`agents/base.py`), which provides a common `run()` interface and logging.

---

## Embedding Model

| Property | Value |
|----------|-------|
| Model | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` |
| Dimensions | 384 |
| Languages | 50+, including Norwegian |
| Runtime | Local (no API key required) |
| Size | ~120 MB |

The multilingual model handles Norwegian podcast content without any translation step.

---

## LLM Options

All LLM options use the OpenAI-compatible chat completions API. Switch provider by updating three environment variables — no code changes needed.

| Provider | `LLM_URL` | `LLM_MODEL` | Cost |
|----------|-----------|-------------|------|
| Gemini Flash 2.0 (recommended) | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-2.0-flash` | Free tier available |
| Ollama (local) | `http://localhost:11434/v1/chat/completions` | `qwen3:8b` | Free |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.1-8b-instant` | Free tier available |

---

## Vector Database

**Default: ChromaDB** (persistent, local)

- Collection: `utbytte_episodes`
- Distance metric: cosine similarity
- Stored per chunk: text, embedding, episode title, episode number, chunk index, timestamp

**Alternative: Supabase pgvector** — see [deployment.md](deployment.md#supabase-pgvector-alternative) for migration guide.

---

## File Storage Layout

```
backend/storage/
├── audio/           # Downloaded MP3 files (gitignored, large)
├── transcripts/     # Whisper output .jsonl + .md (committed to git)
├── chromadb/        # ChromaDB vector store (gitignored, auto-rebuilt)
└── manifest.json    # Tracks processed episodes (gitignored)
```

The transcripts folder is committed so the vector database can be rebuilt from text without re-downloading and re-transcribing ~100 audio files.

---

## API Layer

FastAPI app at `backend/api/main.py` with four route groups:

| Prefix | File | Purpose |
|--------|------|---------|
| `/api/episodes` | `routes/episodes.py` | List episodes, get episode details |
| `/api/pipeline` | `routes/pipeline.py` | Trigger ingestion pipeline |
| `/api/qa` | `routes/qa.py` | Ask questions (RAG endpoint) |
| `/api/topics` | `routes/topics.py` | Topic/keyword search |

CORS is configured in `api/main.py` to allow the frontend origin (`FRONTEND_URL` env var).
