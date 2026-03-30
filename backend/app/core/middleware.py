import time
from collections import defaultdict
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger

logger = get_logger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory sliding-window rate limiter."""

    def __init__(self, app, requests_per_period: int = 10, period_seconds: int = 60):
        super().__init__(app)
        self.requests_per_period = requests_per_period
        self.period_seconds = period_seconds
        self._store: dict[str, list[float]] = defaultdict(list)

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only rate limit the chat endpoint
        if not request.url.path.startswith("/api/chat"):
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        now = time.time()
        window_start = now - self.period_seconds

        # Clean old entries
        self._store[client_ip] = [
            ts for ts in self._store[client_ip] if ts > window_start
        ]

        if len(self._store[client_ip]) >= self.requests_per_period:
            logger.warning("rate_limit_exceeded", client_ip=client_ip)
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded. Max {self.requests_per_period} requests per {self.period_seconds}s."
                },
            )

        self._store[client_ip].append(now)
        return await call_next(request)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log all incoming requests with timing."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        logger.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        return response
