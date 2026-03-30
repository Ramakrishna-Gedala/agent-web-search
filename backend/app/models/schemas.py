from typing import Optional
from pydantic import BaseModel, Field


class Source(BaseModel):
    """A web source returned by the search agent."""

    url: str = Field(description="The URL of the source")
    title: str = Field(default="", description="The page title")
    snippet: str = Field(default="", description="A brief excerpt from the page")


class ChatRequest(BaseModel):
    """Incoming chat request."""

    query: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="The user's search query",
        examples=["What are the latest AI breakthroughs in 2025?"],
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Optional session ID for conversation continuity",
    )


class ChatResponse(BaseModel):
    """Structured response from the search agent."""

    query: str = Field(description="The original user query")
    answer: str = Field(description="The agent's synthesized answer")
    sources: list[Source] = Field(
        default_factory=list,
        description="List of web sources used to generate the answer",
    )
    session_id: Optional[str] = Field(
        default=None, description="Session ID for this conversation"
    )


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    version: str
    service: str
