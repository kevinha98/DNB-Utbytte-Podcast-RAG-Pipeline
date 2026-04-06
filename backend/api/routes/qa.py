from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from agents.base import AgentMessage
from api.schemas import QARequest, QAResponse
from db_userdata import get_global_memory, get_instructions, get_recent_corrections

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/qa", tags=["qa"])


def _extract_filters(body: QARequest) -> dict:
    filters: dict = {}
    if body.filters:
        if body.filters.episode_numbers:
            filters["episode_numbers"] = body.filters.episode_numbers
        if body.filters.date_from:
            filters["date_from"] = body.filters.date_from
        if body.filters.date_to:
            filters["date_to"] = body.filters.date_to
    return filters


@router.post("", response_model=QAResponse)
async def ask_question(body: QARequest, request: Request):
    qa_agent = request.app.state.qa_agent

    result = await qa_agent.execute(
        AgentMessage(
            sender="api",
            msg_type="qa",
            payload=body.question,
            metadata={
                "filters": _extract_filters(body),
                "model": body.model,
                "use_web": body.use_web,
            },
        )
    )

    if not result.success:
        return QAResponse(
            answer=f"Beklager, noe gikk galt: {result.error}",
            sources=[],
            confidence=0.0,
        )

    return QAResponse(**result.data)


@router.post("/stream")
async def ask_question_stream(body: QARequest, request: Request):
    """SSE streaming endpoint — sends sources, token deltas, then done."""
    qa_agent = request.app.state.qa_agent
    loop = asyncio.get_event_loop()
    filters = _extract_filters(body)
    question = body.question.strip()
    model = body.model
    use_web = body.use_web
    user_id = (body.user_id or "").strip() or None

    # Load per-user personalisation + global memory (synchronous DB reads)
    instructions: dict | None = None
    corrections: list[dict] = []
    global_memory: list[dict] = []
    if user_id:
        instructions = await loop.run_in_executor(None, get_instructions, user_id)
        corrections = await loop.run_in_executor(None, get_recent_corrections, user_id, 5)
    global_memory = await loop.run_in_executor(None, get_global_memory, 3)

    async def event_generator():
        try:
            # Step 1: Expand queries
            queries = await loop.run_in_executor(
                None, qa_agent._expand_queries, question
            )

            # Step 2: Vector search & merge
            where = qa_agent._build_where_filter(filters)
            merged: dict[str, tuple[str, dict, float]] = {}
            for q in queries:
                embedding = await loop.run_in_executor(
                    None, qa_agent._embed_query, q
                )
                results = await loop.run_in_executor(
                    None, qa_agent._db.query, embedding, 30, where
                )
                if not results or not results.get("documents") or not results["documents"][0]:
                    continue
                ids = results.get("ids", [[]])[0]
                docs = results["documents"][0]
                metas = results["metadatas"][0]
                dists = results["distances"][0]
                for chunk_id, doc, meta, dist in zip(ids, docs, metas, dists):
                    if chunk_id not in merged or dist < merged[chunk_id][2]:
                        merged[chunk_id] = (doc, meta, dist)

            if not merged:
                sorted_chunks = await loop.run_in_executor(
                    None, qa_agent._fallback_chunks_from_transcripts, question, 20
                )
                if not sorted_chunks:
                    yield f"event: sources\ndata: {json.dumps({'sources': [], 'confidence': 0.0})}\n\n"
                    yield f"event: token\ndata: {json.dumps({'text': 'Beklager, jeg fant ingen relevante episoder for dette spørsmålet.'})}\n\n"
                    yield "event: done\ndata: {}\n\n"
                    return
            else:
                # Step 3: Filter & cap
                sorted_chunks = sorted(merged.values(), key=lambda x: x[2])

            SIMILARITY_THRESHOLD = 0.40
            relevant = [
                (d, m, dist) for d, m, dist in sorted_chunks if (1 - dist) >= SIMILARITY_THRESHOLD
            ]
            if not relevant:
                relevant = sorted_chunks[:15]
            relevant = relevant[:80]

            # Step 4: Build context with full transcripts
            context = await loop.run_in_executor(
                None, qa_agent._build_context_with_full_transcripts, relevant
            )

            web_context = ""
            web_hits: list[dict[str, str]] = []
            if use_web:
                web_hits = await loop.run_in_executor(
                    None, qa_agent._search_web, question, 5
                )
                web_context = qa_agent._build_web_context(web_hits)

            # Step 5: Stream — sources + LLM tokens + done
            for sse_event in qa_agent.prepare_streaming(
                question,
                context,
                relevant,
                model=model,
                web_context=web_context,
                web_hits=web_hits,
                instructions=instructions,
                corrections=corrections,
                global_memory=global_memory,
            ):
                yield sse_event

        except Exception:
            logger.exception("Streaming QA error")
            yield f"event: error\ndata: {json.dumps({'error': 'Intern feil under streaming'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
