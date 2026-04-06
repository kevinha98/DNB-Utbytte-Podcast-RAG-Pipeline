# Deployment Guide

## Option 1: Docker Compose (Self-hosted)

The simplest full-stack deployment. Requires Docker and Docker Compose.

```bash
# Clone and configure
git clone git@github.com:kevinha98/DNB-Utbytte-Podcast-RAG-Pipeline.git
cd DNB-Utbytte-Podcast-RAG-Pipeline
cp .env.example .env
# Edit .env: set LLM_API_KEY, FRONTEND_URL, etc.

# Build and start
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

The `docker-compose.yml` starts:
- `backend` on port 8000
- `frontend` on port 3002

---

## Option 2: Vercel (Frontend) + Google Cloud Run (Backend)

Recommended for production. Frontend on Vercel CDN, backend on a managed container.

### Frontend — Vercel

1. Connect the repo to Vercel (import from GHE)
2. Set build settings in `frontend/vercel.json` (already configured)
3. Add environment variable in Vercel dashboard:
   - `NEXT_PUBLIC_API_URL` → your Cloud Run backend URL (e.g. `https://utbytte-backend-xxx-ew.a.run.app`)
4. Deploy: Vercel auto-deploys on push to `main`

### Backend — Google Cloud Run

```bash
# Build and push container
gcloud builds submit --tag gcr.io/YOUR_PROJECT/utbytte-backend ./

# Deploy to Cloud Run
gcloud run deploy utbytte-backend \
  --image gcr.io/YOUR_PROJECT/utbytte-backend \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars LLM_API_KEY=your_key,LLM_MODEL=gemini-2.0-flash \
  --memory 2Gi \
  --cpu 2
```

> **Note**: Cloud Run does not support persistent volumes. ChromaDB will reset on each deploy.  
> For production use, migrate to Supabase pgvector (see below) or mount a Cloud Storage FUSE bucket.

---

## Option 3: Supabase pgvector (Alternative Vector Store) {#supabase-pgvector-alternative}

Supabase provides a managed PostgreSQL database with the `pgvector` extension, suitable for replacing ChromaDB in production.

### Schema Migration

```sql
-- Enable pgvector
create extension if not exists vector;

-- Episode chunks table
create table episode_chunks (
  id          uuid primary key default gen_random_uuid(),
  episode_num integer not null,
  episode_title text not null,
  chunk_index integer not null,
  text        text not null,
  embedding   vector(384),  -- matches sentence-transformers dim
  timestamp   text,
  created_at  timestamptz default now()
);

-- Cosine similarity index (IVFFlat for large datasets)
create index on episode_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
```

### Query

```sql
-- Find top-5 similar chunks for a query embedding
select episode_title, chunk_index, text,
       1 - (embedding <=> $1::vector) as similarity
from episode_chunks
order by embedding <=> $1::vector
limit 5;
```

### Migration Steps

1. Create a Supabase project and run the schema above
2. Set `DATABASE_URL` in your `.env`
3. Modify `agents/database.py` to use `psycopg2` / `asyncpg` instead of ChromaDB client
4. Re-run the full ingestion pipeline to populate Supabase

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_KEY` | Yes | API key for LLM provider (or `ollama` for local) |
| `LLM_URL` | Yes | OpenAI-compatible endpoint URL |
| `LLM_MODEL` | Yes | Model name (e.g. `gemini-2.0-flash`) |
| `FRONTEND_URL` | Yes | Frontend origin for CORS (e.g. `https://your-app.vercel.app`) |
| `WHISPER_MODEL` | No | Whisper model size: `tiny`, `small`, `medium`, `large-v3` (default: `small`) |
| `CHROMA_PATH` | No | Path to ChromaDB storage (default: `backend/storage/chromadb`) |

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Transcription (Whisper small) | 4 GB RAM | 8 GB RAM |
| Transcription (Whisper large-v3) | 12 GB RAM | 16 GB RAM + GPU |
| Embeddings (sentence-transformers) | 1 GB RAM | 2 GB RAM |
| Ollama (qwen3:8b) | 8 GB RAM | 16 GB RAM |
| ChromaDB | 512 MB RAM | 1 GB RAM |

For cloud deployment without a GPU, use Whisper `small` and Gemini Flash for the LLM. The embedding model runs acceptably on CPU.
