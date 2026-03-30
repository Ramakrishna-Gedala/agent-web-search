"""
chat.py
─────────────────────────────────────────────────────────────────────────────
FastAPI route handlers — the "front door" of the backend.

Responsibilities:
  - Declare HTTP endpoints (URLs + methods)
  - Validate incoming request bodies (done automatically by Pydantic)
  - Delegate work to agent_service
  - Return structured responses or handle errors gracefully

Endpoints defined here:
  GET  /api/health        → liveness check
  POST /api/chat          → non-streaming: wait for full answer, return JSON
  POST /api/chat/stream   → streaming: return SSE stream of tokens + sources
─────────────────────────────────────────────────────────────────────────────
"""

import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.models.schemas import ChatRequest, ChatResponse, HealthResponse
from app.services.agent_service import agent_service
from app.config import settings

logger = get_logger(__name__)

# APIRouter groups related endpoints together.
# Registered in main.py with prefix="/api", so all paths below are /api/...
router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Health Check
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check() -> HealthResponse:
    """
    Liveness probe — confirms the server is running.
    Used by load balancers and monitoring tools.
    Returns app name and version from config.
    """
    return HealthResponse(version=settings.APP_VERSION, service=settings.APP_NAME)


# ─────────────────────────────────────────────────────────────────────────────
# Non-Streaming Chat
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="Run web search agent",
    description="Submit a query to the AI agent. Returns a synthesized answer with sources.",
    tags=["Chat"],
)
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Non-streaming endpoint — waits for the full agent response, then returns
    everything at once as a JSON object.

    Request body (ChatRequest):
        { "query": "What is LangChain?", "session_id": "optional-uuid" }

    Response (ChatResponse):
        {
          "query": "What is LangChain?",
          "answer": "## What is LangChain?\\n\\n...",
          "sources": [{"url": "...", "title": "...", "snippet": "..."}],
          "session_id": "abc-123"
        }

    Use this when you need the complete answer before doing anything with it
    (e.g., server-side processing, non-browser clients).
    For browser chat UIs, prefer /chat/stream for better perceived performance.
    """
    # Generate a session ID if the client didn't provide one.
    # uuid4() creates a random UUID like "3f8a2c1b-4d9e-11ec-bf63-0242ac130002"
    session_id = request.session_id or str(uuid.uuid4())

    logger.info("chat_request", query=request.query[:120], session_id=session_id)

    try:
        # Delegate to the agent service — this is where all AI logic runs.
        # await means: pause here, let other requests run, resume when done.
        response = await agent_service.search(
            query=request.query, session_id=session_id
        )
        return response

    except ValueError as exc:
        # Raised for invalid inputs caught during agent execution
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception as exc:
        # Catch-all for unexpected errors (API failures, network issues, etc.)
        # Log the real error server-side, return a safe message to the client
        logger.error("chat_error", error=str(exc))
        raise HTTPException(
            status_code=500,
            detail="The agent encountered an error. Please try again.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Streaming Chat (SSE)
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/chat/stream",
    summary="Stream web search agent response",
    description="Submit a query and receive the response as a Server-Sent Events stream.",
    tags=["Chat"],
)
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """
    Streaming endpoint — sends the response token by token as it is generated.

    Uses Server-Sent Events (SSE):
      - The HTTP connection stays open
      - The server pushes data lines as they become available
      - The browser reads each line immediately (no polling needed)

    StreamingResponse wraps agent_service.stream_search() which is an async
    generator — it yields one SSE event string at a time.

    Each event is a line like:
        data: {"type": "token",  "content": "Hello "}\\n\\n
        data: {"type": "source", "source": {...}}\\n\\n
        data: {"type": "done",   "sources": [...]}\\n\\n

    Headers:
        Cache-Control: no-cache       → don't cache streaming responses
        X-Accel-Buffering: no         → tell nginx not to buffer (send immediately)
    """
    logger.info("stream_request", query=request.query[:120])

    # StreamingResponse keeps the HTTP connection open and sends each yielded
    # string from stream_search() to the browser as it arrives.
    return StreamingResponse(
        agent_service.stream_search(query=request.query),  # async generator
        media_type="text/event-stream",  # SSE content type
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
