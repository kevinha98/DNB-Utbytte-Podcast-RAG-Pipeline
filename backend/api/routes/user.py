"""User instructions, feedback, and global memory API routes."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from db_userdata import (
    delete_feedback,
    ensure_user,
    get_global_memory,
    get_instructions,
    get_user_feedback,
    save_feedback,
    save_instructions,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["user"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class InstructionsRequest(BaseModel):
    preset_tone: str | None = Field(None, max_length=50)
    preset_language: str | None = Field(None, max_length=50)
    preset_focus: str | None = Field(None, max_length=50)
    free_text: str | None = Field(None, max_length=500)


class InstructionsResponse(BaseModel):
    preset_tone: str | None
    preset_language: str | None
    preset_focus: str | None
    free_text: str | None


class FeedbackRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    answer: str = Field(..., min_length=1, max_length=20000)
    thumbs: int = Field(..., ge=0, le=1)  # 0 = thumbs down, 1 = thumbs up
    correction: str | None = Field(None, max_length=1000)


class FeedbackResponse(BaseModel):
    id: str


class GlobalMemoryPattern(BaseModel):
    id: str
    pattern: str
    example_question: str | None
    example_correction: str | None
    score: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_id(x_user_id: str | None) -> str:
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="X-User-ID header is required")
    uid = x_user_id.strip()[:64]  # cap length
    ensure_user(uid)
    return uid


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/user/instructions", response_model=InstructionsResponse)
async def get_user_instructions(
    x_user_id: str | None = Header(default=None),
):
    uid = _get_user_id(x_user_id)
    return get_instructions(uid)


@router.put("/api/user/instructions", response_model=InstructionsResponse)
async def put_user_instructions(
    body: InstructionsRequest,
    x_user_id: str | None = Header(default=None),
):
    uid = _get_user_id(x_user_id)
    save_instructions(
        uid,
        body.preset_tone,
        body.preset_language,
        body.preset_focus,
        body.free_text,
    )
    return get_instructions(uid)


@router.post("/api/feedback", response_model=FeedbackResponse)
async def post_feedback(
    body: FeedbackRequest,
    x_user_id: str | None = Header(default=None),
):
    uid = _get_user_id(x_user_id)
    feedback_id = save_feedback(
        uid,
        body.question,
        body.answer,
        body.thumbs,
        body.correction,
    )
    return FeedbackResponse(id=feedback_id)


@router.get("/api/user/feedback")
async def list_user_feedback(
    x_user_id: str | None = Header(default=None),
):
    uid = _get_user_id(x_user_id)
    return get_user_feedback(uid, limit=20)


@router.delete("/api/user/feedback/{feedback_id}")
async def remove_feedback(
    feedback_id: str,
    x_user_id: str | None = Header(default=None),
):
    uid = _get_user_id(x_user_id)
    deleted = delete_feedback(feedback_id, uid)
    if not deleted:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return {"ok": True}


@router.get("/api/global/memory", response_model=list[GlobalMemoryPattern])
async def get_global_memory_route():
    return get_global_memory(limit=10)
