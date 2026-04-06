#!/bin/sh
# startup.sh — Cloud entrypoint for Utbytte backend
# 1. If ChromaDB is empty, rebuild index from transcripts (one-time, ~10 min)
# 2. Start FastAPI server

set -e

CHROMA_DIR="/app/storage/chromadb"
TRANSCRIPT_DIR="/app/storage/transcripts"

echo "=== Utbytte Backend Startup ==="

# Count docs in ChromaDB via Python one-liner
DOC_COUNT=$(python -c "
import sys, os
sys.path.insert(0, '/app')
try:
    import chromadb
    client = chromadb.PersistentClient(path='$CHROMA_DIR')
    col = client.get_or_create_collection('utbytte_episodes')
    print(col.count())
except Exception as e:
    print(0)
" 2>/dev/null)

echo "ChromaDB document count: $DOC_COUNT"

if [ "$DOC_COUNT" -lt "100" ]; then
    echo "ChromaDB is empty — starting reindex in background (takes ~10-15 min)..."
    python /app/reindex.py >> /tmp/reindex.log 2>&1 &
    echo "Reindex running in background (PID $!). Server will start immediately."
else
    echo "ChromaDB OK ($DOC_COUNT docs) — skipping reindex."
fi

echo "Starting FastAPI server..."
exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}
