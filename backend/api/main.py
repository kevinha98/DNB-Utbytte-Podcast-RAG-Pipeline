from __future__ import annotations

import logging
from contextlib import asynccontextmanager

# Inject Windows system CA certificates (corporate proxy support)
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from agents.chunker import ChunkerAgent
from agents.database import DatabaseAgent
from agents.downloader import DownloaderAgent
from agents.planner import PlannerAgent
from agents.qa import QAAgent
from agents.transcriber import TranscriberAgent
from api.routes import episodes, pipeline, qa, topics, user
from config import settings
from db_userdata import ensure_schema
from pipeline.orchestrator import PipelineOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize agents and orchestrator
    settings.ensure_dirs()
    ensure_schema()  # create userdata.db tables if missing

    planner = PlannerAgent()
    downloader = DownloaderAgent()
    transcriber = TranscriberAgent()
    chunker = ChunkerAgent()
    database = DatabaseAgent()
    qa_agent = QAAgent(database_agent=database)

    orchestrator = PipelineOrchestrator(
        planner=planner,
        downloader=downloader,
        transcriber=transcriber,
        chunker=chunker,
        database=database,
        max_concurrent=settings.max_concurrent_episodes,
    )

    app.state.orchestrator = orchestrator
    app.state.qa_agent = qa_agent
    app.state.database_agent = database

    logger.info("Utbytte Agent API started")
    yield
    logger.info("Utbytte Agent API shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Utbytte Podcast AI Assistant",
        description="AI-powered Q&A for the Utbytte podcast by DNB",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS — allow all origins so the hosted Pages frontend can reach a local/tunnelled backend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # Routes
    app.include_router(episodes.router)
    app.include_router(qa.router)
    app.include_router(pipeline.router)
    app.include_router(topics.router)
    app.include_router(user.router)

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "1.0.0"}

    return app


app = create_app()
