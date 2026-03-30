"""
agent_service.py
─────────────────────────────────────────────────────────────────────────────
The core AI logic of the application.

This module creates and runs a LangGraph ReAct agent that:
  1. Receives a user question
  2. Decides whether to search the web (using Tavily)
  3. Reads the search results
  4. Writes a synthesized, Markdown-formatted answer

Two modes are supported:
  - search()        → waits for the full answer, returns it all at once
  - stream_search() → yields tokens and sources in real time (SSE streaming)

ReAct = Reason + Act loop:
  [Reason] → should I search? → [Act] call TavilySearch → [Observe] read results
  → [Reason] → do I have enough? → [Respond] write final answer
─────────────────────────────────────────────────────────────────────────────
"""

import json
from typing import AsyncGenerator

# LangChain message types — the agent's conversation history is a list of these
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
# Gemini LLM adapter — wraps Google's Gemini API for LangChain
from langchain_google_genai import ChatGoogleGenerativeAI
# Pre-built Tavily search tool — searches the live web and returns structured results
from langchain_tavily import TavilySearch
# create_react_agent builds the ReAct loop: LLM + tools → agent graph
from langgraph.prebuilt import create_react_agent

from app.config import settings
from app.core.logging import get_logger
from app.models.schemas import ChatResponse, Source

logger = get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# System Prompt
# This is sent to Gemini BEFORE the user's question on every request.
# It defines the AI's role, behaviour, and output format.
# Think of it as the employee handbook given to Gemini before it starts work.
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert AI research assistant with real-time web search capabilities.

When answering questions:
1. Search the web for accurate, up-to-date information
2. Synthesize findings from multiple sources
3. Structure your answer clearly with headers and bullet points where appropriate
4. Be comprehensive yet concise
5. Always base your answer on the search results

Format your responses in Markdown for better readability."""


class AgentService:
    """
    Wraps a LangGraph ReAct agent (Gemini + Tavily) and exposes two methods:
      - search()        → blocking, returns complete ChatResponse
      - stream_search() → async generator, yields SSE-formatted strings

    The agent is built lazily (on first use) so that:
      - Server startup is fast
      - API key errors surface at request time with clear messages
    """

    def __init__(self) -> None:
        # _agent is None until the first request — see the @property below
        self._agent = None

    # ─────────────────────────────────────────────────────────────────────────
    # Agent construction
    # ─────────────────────────────────────────────────────────────────────────

    def _build_agent(self):
        """
        Build and wire together all AI components:
          LLM (Gemini) + Tool (Tavily) → ReAct agent

        Called once on first use, result is cached in self._agent.
        """

        # ── LLM ──────────────────────────────────────────────────────────────
        # ChatGoogleGenerativeAI is LangChain's adapter for Google Gemini.
        # It translates LangChain's standard interface to Google's API.
        llm = ChatGoogleGenerativeAI(
            model=settings.GOOGLE_LLM_MODEL,        # e.g. "gemini-2.5-flash"
            google_api_key=settings.GOOGLE_API_KEY,
            temperature=0.3,  # 0 = deterministic/factual, 1 = creative
                              # 0.3 is good for research: mostly factual with
                              # natural-sounding prose
        )

        # ── Search Tool ───────────────────────────────────────────────────────
        # TavilySearch is a pre-built LangChain tool. When the agent calls it:
        #   Input:  a search query string
        #   Output: list of {url, title, content} dicts from the live web
        search_tool = TavilySearch(
            max_results=settings.TAVILY_MAX_RESULTS,  # how many pages to return
            tavily_api_key=settings.TAVILY_API_KEY,
        )

        # ── ReAct Agent ───────────────────────────────────────────────────────
        # create_react_agent builds a LangGraph state machine with two nodes:
        #   1. agent_node  — calls the LLM to decide the next action
        #   2. tool_node   — executes the chosen tool (TavilySearch)
        #
        # The graph loops: agent → tool → agent → tool → ... → agent (final answer)
        # It stops when the LLM produces a response with no tool_calls.
        return create_react_agent(
            model=llm,
            tools=[search_tool],
            prompt=SYSTEM_PROMPT,  # prepended to every conversation
        )

    @property
    def agent(self):
        """
        Lazy-initialisation pattern.

        self.agent behaves like a normal attribute, but the first time it is
        accessed, _build_agent() runs and the result is cached. All subsequent
        accesses return the cached agent instantly — no rebuild overhead.

        Usage in this class:
            result = await self.agent.ainvoke(...)  ← triggers build on 1st call
        """
        if self._agent is None:
            self._agent = self._build_agent()
        return self._agent

    # ─────────────────────────────────────────────────────────────────────────
    # Helper: extract sources from the agent's message history
    # ─────────────────────────────────────────────────────────────────────────

    def _extract_sources(self, messages: list) -> list[Source]:
        """
        After the agent finishes, its full conversation is in `messages`.
        We look for ToolMessage objects — these are created by LangChain every
        time TavilySearch returns results.

        Each ToolMessage.content looks like (JSON string or list):
            [
              {"url": "https://...", "title": "...", "content": "excerpt..."},
              {"url": "https://...", "title": "...", "content": "excerpt..."},
            ]

        We parse those, deduplicate by URL, and return clean Source objects.
        """
        sources: list[Source] = []
        seen_urls: set[str] = set()  # tracks URLs we've already added

        for msg in messages:
            # skip everything that isn't a tool result
            if not isinstance(msg, ToolMessage):
                continue
            try:
                raw = msg.content
                # TavilySearch may return a JSON string OR a Python list
                # depending on the version — handle both
                if isinstance(raw, str):
                    data = json.loads(raw)   # parse JSON string → Python list
                elif isinstance(raw, list):
                    data = raw               # already a list, use directly
                else:
                    continue

                if not isinstance(data, list):
                    continue

                for item in data:
                    if not isinstance(item, dict):
                        continue
                    url = item.get("url", "").strip()
                    # skip empty URLs and duplicates
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        sources.append(
                            Source(
                                url=url,
                                title=item.get("title", ""),
                                # limit snippet to 250 chars to keep response size reasonable
                                snippet=(item.get("content") or "")[:250].strip(),
                            )
                        )
            except Exception as exc:
                # don't crash if one source fails to parse — just skip it
                logger.warning("source_parse_error", error=str(exc))

        return sources

    # ─────────────────────────────────────────────────────────────────────────
    # Helper: extract final answer from the agent's message history
    # ─────────────────────────────────────────────────────────────────────────

    def _extract_answer(self, messages: list) -> str:
        """
        The agent's message history contains multiple AIMessage objects:
          - Some have tool_calls → these are intermediate reasoning steps
            ("I need to search for X")
          - The LAST one without tool_calls → this is the final answer

        We iterate in reverse (newest first) to find the final answer quickly.

        Gemini sometimes returns content as a plain string, sometimes as a
        list of content parts:
            [{"type": "text", "text": "Hello"}, {"type": "text", "text": " world"}]
        We handle both formats.
        """
        for msg in reversed(messages):
            # tool_calls present → this is a mid-reasoning step, skip it
            if isinstance(msg, AIMessage) and not getattr(msg, "tool_calls", None):
                content = msg.content
                if isinstance(content, str):
                    return content
                # Gemini multi-part content: join all text parts
                if isinstance(content, list):
                    return " ".join(
                        part.get("text", "") if isinstance(part, dict) else str(part)
                        for part in content
                    )
        return "I was unable to generate a response. Please try again."

    # ─────────────────────────────────────────────────────────────────────────
    # Public API: non-streaming search
    # ─────────────────────────────────────────────────────────────────────────

    async def search(self, query: str, session_id: str | None = None) -> ChatResponse:
        """
        Run the agent to completion and return the full response at once.

        Flow:
          1. Wrap query in HumanMessage
          2. agent.ainvoke() runs the full ReAct loop and waits for it to finish
          3. Extract answer and sources from the returned message history
          4. Return a structured ChatResponse

        Used by: POST /api/chat
        """
        logger.info("agent_search_start", query=query[:120])

        try:
            # ainvoke() blocks until the entire ReAct loop is done.
            # Input format:  {"messages": [HumanMessage(...)]}
            # Output format: {"messages": [HumanMessage, AIMessage, ToolMessage, AIMessage, ...]}
            result = await self.agent.ainvoke(
                {"messages": [HumanMessage(content=query)]}
            )
        except Exception as exc:
            logger.error("agent_invoke_error", error=str(exc))
            raise

        # result["messages"] is the full conversation history after the agent ran
        messages = result.get("messages", [])
        answer = self._extract_answer(messages)   # last AI response text
        sources = self._extract_sources(messages)  # all Tavily search results

        logger.info(
            "agent_search_done",
            sources_count=len(sources),
            answer_length=len(answer),
        )

        return ChatResponse(
            query=query,
            answer=answer,
            sources=sources,
            session_id=session_id,
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Public API: streaming search (SSE)
    # ─────────────────────────────────────────────────────────────────────────

    async def stream_search(self, query: str) -> AsyncGenerator[str, None]:
        """
        Run the agent and yield results in real time as Server-Sent Events.

        Instead of waiting for the full answer, we stream:
          - Each token (word/piece) as Gemini generates it  → "typing" effect
          - Each source as soon as Tavily returns results   → sources appear early

        This method is an async generator — it uses `yield` instead of `return`.
        FastAPI's StreamingResponse reads each yielded string and sends it to
        the browser immediately over the open HTTP connection.

        SSE format (each yielded string):
            "data: {json}\\n\\n"
            ↑ required prefix   ↑ required double newline (marks end of event)

        Event types we yield:
            {"type": "token",  "content": "Hello "}       ← one LLM token
            {"type": "source", "source": {url, title, snippet}}  ← one web source
            {"type": "done",   "sources": [...]}           ← stream finished
            {"type": "error",  "message": "..."}           ← something went wrong

        Used by: POST /api/chat/stream
        """
        logger.info("agent_stream_start", query=query[:120])

        # Collect sources during streaming so we can include them in the done event
        sources: list[dict] = []
        seen_urls: set[str] = set()  # deduplication

        try:
            # astream_events() runs the agent but fires an event for EVERY step:
            #   - on_chat_model_start    → Gemini started thinking
            #   - on_chat_model_stream   → Gemini produced one token
            #   - on_chat_model_end      → Gemini finished
            #   - on_tool_start          → Tavily search started
            #   - on_tool_end            → Tavily search finished, results ready
            #   - on_chain_start/end     → agent graph node transitions
            #
            # version="v2" uses the current recommended event schema
            async for event in self.agent.astream_events(
                {"messages": [HumanMessage(content=query)]},
                version="v2",
            ):
                # `kind` is the event type string set internally by LangChain
                # e.g. "on_chat_model_stream", "on_tool_end", etc.
                kind = event.get("event", "")

                # ── Token event ───────────────────────────────────────────────
                # Fires for every single token Gemini generates.
                # A "token" is roughly one word or punctuation mark.
                # We forward each token to the browser immediately → typing effect.
                if kind == "on_chat_model_stream":
                    # event["data"]["chunk"] is an AIMessageChunk containing the token
                    chunk = event.get("data", {}).get("chunk")
                    if chunk is None:
                        continue

                    # .content holds the actual text of this token
                    content = getattr(chunk, "content", None)
                    if not content:
                        continue

                    # Normalize content: Gemini may return a string or a list of parts
                    text = ""
                    if isinstance(content, str):
                        text = content
                    elif isinstance(content, list):
                        # list of {"type": "text", "text": "..."} dicts
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                text += part.get("text", "")

                    if text:
                        # Yield SSE token event — browser appends this to the message
                        payload = json.dumps({"type": "token", "content": text})
                        yield f"data: {payload}\n\n"

                # ── Tool result event ─────────────────────────────────────────
                # Fires when TavilySearch finishes and results are available.
                # This happens BEFORE Gemini writes the answer, so sources appear
                # in the UI while the answer is still being typed.
                elif kind == "on_tool_end":
                    # event["data"]["output"] contains the raw Tavily results
                    output = event.get("data", {}).get("output")
                    if not output:
                        continue
                    try:
                        # Normalize: output may be a JSON string or a Python list
                        if isinstance(output, str):
                            results = json.loads(output)
                        elif isinstance(output, list):
                            results = output
                        else:
                            results = []

                        for item in results:
                            if not isinstance(item, dict):
                                continue
                            url = item.get("url", "").strip()
                            if url and url not in seen_urls:
                                seen_urls.add(url)
                                source = {
                                    "url": url,
                                    "title": item.get("title", ""),
                                    "snippet": (item.get("content") or "")[:250].strip(),
                                }
                                sources.append(source)
                                # Yield SSE source event — browser shows a source card
                                payload = json.dumps({"type": "source", "source": source})
                                yield f"data: {payload}\n\n"
                    except Exception as exc:
                        logger.warning("stream_source_parse_error", error=str(exc))

                # All other event types (on_chain_start, on_tool_start, etc.)
                # are ignored — we don't need them for the frontend

        except Exception as exc:
            # Something went wrong mid-stream (API error, network issue, etc.)
            # Send an error event so the browser can show an error message
            logger.error("stream_error", error=str(exc))
            error_payload = json.dumps({"type": "error", "message": "An error occurred during search."})
            yield f"data: {error_payload}\n\n"
            return  # stop the generator

        # ── Done event ────────────────────────────────────────────────────────
        # Sent after all tokens and sources have been streamed.
        # The browser uses this to:
        #   1. Stop the streaming/typing indicator
        #   2. Finalize the sources list with the complete set
        done_payload = json.dumps({"type": "done", "sources": sources})
        yield f"data: {done_payload}\n\n"


# ─────────────────────────────────────────────────────────────────────────────
# Singleton instance
#
# One shared AgentService for the entire application lifetime.
# Imported directly by chat.py:
#   from app.services.agent_service import agent_service
#
# This ensures the agent is built only once (on first request) and reused
# for all subsequent requests — no per-request initialization overhead.
# ─────────────────────────────────────────────────────────────────────────────
agent_service = AgentService()
