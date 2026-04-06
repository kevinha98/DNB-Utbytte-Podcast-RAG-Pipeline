"""
Utbytte Podcast AI Assistant — CLI entry point.

Usage:
    python main.py serve          # Start API server
    python main.py pipeline       # Run full pipeline (all episodes)
    python main.py pipeline -n 3  # Process only 3 episodes
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Inject Windows system CA certificates (corporate proxy support)
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

# Ensure backend/ is on the path
sys.path.insert(0, str(Path(__file__).parent))

from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("utbytte")


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn
    from api.main import app

    logger.info("Starting API server on %s:%d", settings.api_host, settings.api_port)
    uvicorn.run(
        app,
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
    )


def cmd_pipeline(args: argparse.Namespace) -> None:
    from agents.chunker import ChunkerAgent
    from agents.database import DatabaseAgent
    from agents.downloader import DownloaderAgent
    from agents.planner import PlannerAgent
    from agents.transcriber import TranscriberAgent
    from pipeline.orchestrator import PipelineOrchestrator

    settings.ensure_dirs()

    orchestrator = PipelineOrchestrator(
        planner=PlannerAgent(),
        downloader=DownloaderAgent(),
        transcriber=TranscriberAgent(),
        chunker=ChunkerAgent(),
        database=DatabaseAgent(),
        max_concurrent=settings.max_concurrent_episodes,
    )

    def on_progress(progress):
        logger.info(
            "Pipeline: %d/%d done, %d failed, step=%s",
            progress.completed,
            progress.total_episodes,
            progress.failed,
            progress.current_step,
        )

    orchestrator.on_progress(on_progress)

    result = asyncio.run(orchestrator.run_pipeline(max_episodes=args.episodes))

    logger.info(
        "Pipeline finished: %d/%d episodes processed, %d failed",
        result.completed,
        result.total_episodes,
        result.failed,
    )
    if result.errors:
        for err in result.errors:
            logger.error("  Error: %s", err)


def main() -> None:
    parser = argparse.ArgumentParser(description="Utbytte Podcast AI Assistant")
    sub = parser.add_subparsers(dest="command", required=True)

    # serve
    serve_parser = sub.add_parser("serve", help="Start the API server")

    # pipeline
    pipe_parser = sub.add_parser("pipeline", help="Run the processing pipeline")
    pipe_parser.add_argument(
        "-n", "--episodes", type=int, default=None,
        help="Max number of episodes to process",
    )

    args = parser.parse_args()
    if args.command == "serve":
        cmd_serve(args)
    elif args.command == "pipeline":
        cmd_pipeline(args)


if __name__ == "__main__":
    main()
