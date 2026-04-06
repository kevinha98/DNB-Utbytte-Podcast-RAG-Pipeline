from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request

from api.schemas import PipelineStartRequest, PipelineStatusResponse

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.post("/start")
async def start_pipeline(
    body: PipelineStartRequest,
    request: Request,
):
    orchestrator = request.app.state.orchestrator

    if orchestrator.progress.is_running:
        return {"status": "already_running", "progress": orchestrator.progress.to_dict()}

    asyncio.create_task(orchestrator.run_pipeline(max_episodes=body.max_episodes))

    return {"status": "started", "max_episodes": body.max_episodes}


@router.get("/status", response_model=PipelineStatusResponse)
async def pipeline_status(request: Request):
    orchestrator = request.app.state.orchestrator
    return PipelineStatusResponse(**orchestrator.progress.to_dict())
