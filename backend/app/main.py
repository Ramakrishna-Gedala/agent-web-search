"""
main.py
─────────────────────────────────────────────────────────────────────────────
FastAPI application factory — the entry point for the backend server.

This file:
  1. Creates the FastAPI app instance
  2. Attaches middleware (CORS, rate limiting, request logging)
  3. Registers routers (API endpoints)
  4. Handles startup / shutdown lifecycle events

Run with:
    uvicorn app.main:app --reload --port 8000
─────────────────────────────────────────────────────────────────────────────
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.core.logging import get_logger, setup_logging
from app.core.middleware import RateLimitMiddleware, RequestLoggingMiddleware
from app.api.routes.chat import router as chat_router

# Set up structured logging before anything else runs.
# debug=True  → coloured console output (human-readable)
# debug=False → JSON output (suitable for log aggregation tools like Datadog)
setup_logging(debug=settings.DEBUG)
logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan — startup and shutdown hooks
# ─────────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Code before `yield` runs at server startup.
    Code after  `yield` runs at server shutdown.

    We use this to log startup info. In a more complex app you might:
      - Connect to a database here
      - Warm up ML models
      - Initialise caches
    """
    # Startup
    logger.info(
        "startup",
        service=settings.APP_NAME,
        version=settings.APP_VERSION,
        model=settings.GOOGLE_LLM_MODEL,
    )
    yield
    # Shutdown
    logger.info("shutdown", service=settings.APP_NAME)


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI app instance
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered web search agent using LangChain, Gemini, and Tavily.",
    docs_url="/docs",    # Swagger UI  → http://localhost:8000/docs
    redoc_url="/redoc",  # ReDoc UI    → http://localhost:8000/redoc
    lifespan=lifespan,
)


# ─────────────────────────────────────────────────────────────────────────────
# Middleware stack
#
# Middleware runs on every request, in the order they are added (outermost first).
# Think of it as layers of an onion — request passes through each layer going in,
# and through each layer again (in reverse) going out.
#
# Order here:
#   CORSMiddleware           ← outermost: handles preflight before anything else
#   RateLimitMiddleware      ← blocks excessive requests early
#   RequestLoggingMiddleware ← logs every request with timing
#   FastAPI Router           ← innermost: your actual endpoint code
# ─────────────────────────────────────────────────────────────────────────────

# CORS (Cross-Origin Resource Sharing)
# Without this, the browser blocks requests from the frontend (localhost:5173)
# to the backend (localhost:8000) because they are on different ports.
# allow_origins lists the domains that are permitted to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,  # ["http://localhost:5173", ...]
    allow_credentials=True,
    allow_methods=["*"],   # GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],   # Content-Type, Authorization, etc.
)

# Rate Limiting
# Limits each IP address to N requests per time window.
# Prevents abuse and protects against runaway API costs.
# Uses a sliding window algorithm stored in memory.
app.add_middleware(
    RateLimitMiddleware,
    requests_per_period=settings.RATE_LIMIT_REQUESTS,  # default: 10
    period_seconds=settings.RATE_LIMIT_PERIOD,          # default: 60s
)

# Request Logging
# Logs every HTTP request with method, path, status code, and duration.
# Useful for debugging and performance monitoring.
app.add_middleware(RequestLoggingMiddleware)


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

# Register the chat router with a /api prefix.
# All endpoints in chat.py (e.g. /health, /chat) become /api/health, /api/chat
app.include_router(chat_router, prefix="/api")


# ─────────────────────────────────────────────────────────────────────────────
# Root endpoint
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Root"])
async def root():
    """Basic service info — useful for verifying the server is up."""
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
    }
