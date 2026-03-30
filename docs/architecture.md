# Architecture — Agent Web Search

## Overview

Agent Web Search is built on a **3-layer architecture** with clear separation of concerns:

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐
│   Frontend   │ ───▶ │   API Layer  │ ───▶ │   Agent/AI Layer     │
│  React + TS  │ ◀─── │   FastAPI    │ ◀─── │  LangGraph + Gemini  │
└──────────────┘      └──────────────┘      └──────────────────────┘
                                                        │
                                              ┌─────────▼─────────┐
                                              │   Tool Layer       │
                                              │  Tavily Search API │
                                              └────────────────────┘
```

---

## Component Breakdown

### Layer 1: Frontend (React)

**Responsibilities:**
- Render chat UI with streaming support
- Manage message state and streaming token accumulation
- Display sources as interactive cards
- Handle SSE stream from backend

**Key design decisions:**
- **Vite proxy** routes `/api/*` to backend — avoids CORS in development and mirrors production nginx behavior
- **SSE over WebSockets** — SSE is simpler (HTTP/1.1 compatible, automatic reconnect, no handshake overhead) and sufficient for one-way streaming
- **Custom `useChat` hook** encapsulates all streaming state management, keeping components pure and testable
- **react-markdown** renders Gemini's Markdown-formatted answers safely

**Component tree:**
```
App
├── Header
└── ChatInterface
    ├── WelcomeScreen (when no messages)
    ├── MessageBubble[] (user + assistant messages)
    │   ├── ReactMarkdown (AI answer)
    │   └── SourceCard[] (cited web sources)
    └── SearchInput (textarea + send button)
```

---

### Layer 2: API Gateway (FastAPI)

**Responsibilities:**
- HTTP request validation (Pydantic)
- CORS policy enforcement
- Rate limiting (sliding window, per-IP)
- Request/response logging
- Route to agent service

**Middleware stack (outermost → innermost):**
```
Request
  → CORSMiddleware          # Allow cross-origin from frontend
  → RateLimitMiddleware     # 10 req/60s per IP
  → RequestLoggingMiddleware # Structured timing logs
  → FastAPI Router
      → /api/health         # Liveness probe
      → /api/chat           # Non-streaming (POST)
      → /api/chat/stream    # SSE streaming (POST)
```

**Rate limiting strategy:** Sliding window, stored in-memory. For production scale, replace with Redis + `limits` library.

**Streaming endpoint:** Returns `StreamingResponse` with `text/event-stream` MIME type. Each SSE event is a JSON payload on a `data:` line followed by `\n\n`.

---

### Layer 3: Agent Service (LangChain/LangGraph)

**Responsibilities:**
- Maintain the ReAct agent loop
- Initialize and configure LLM + tools
- Parse and extract sources from tool outputs
- Support both blocking and async streaming invocation

**Agent architecture:**

```
LangGraph ReAct Agent
│
├── State: { messages: BaseMessage[] }
│
├── Nodes:
│   ├── agent_node      — calls LLM to decide next action
│   └── tool_node       — executes selected tool(s)
│
└── Edges:
    ├── agent → tool_node   (when tool_calls present)
    └── agent → END         (when final response ready)
```

**ReAct loop (Reason → Act → Observe):**

```
[HumanMessage: "What is X?"]
       │
       ▼
  [LLM reasons: "I need to search for X"]
       │
       ▼
  [AIMessage with tool_calls: TavilySearch("X")]
       │
       ▼
  [ToolMessage: [{"url": ..., "title": ..., "content": ...}]]
       │
       ▼
  [LLM reasons: "I have enough info, synthesizing..."]
       │
       ▼
  [AIMessage: "## Answer\n\nBased on my research..."]
```

**Lazy initialization:** The agent is built on first use (`@property agent`), so FastAPI startup is fast and API keys are validated at request time (better error messages).

---

### Layer 4: Tool Layer (Tavily)

**Tool:** `TavilySearch` from `langchain-tavily`

**Output per result:**
```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "content": "Relevant excerpt...",
  "score": 0.95
}
```

**Source extraction:** The `AgentService._extract_sources()` method parses `ToolMessage` objects from the agent's message history, deduplicates by URL, and returns structured `Source` objects.

---

## Data Flow — Streaming Request

```
1. POST /api/chat/stream { "query": "..." }
        │
        ▼
2. FastAPI validates Pydantic model
        │
        ▼
3. AgentService.stream_search(query) → AsyncGenerator[str]
        │
        ├── astream_events(version="v2")
        │       │
        │       ├── on_chat_model_stream → yield SSE token events
        │       └── on_tool_end         → yield SSE source events
        │
        └── final yield: SSE done event
        │
        ▼
4. StreamingResponse(media_type="text/event-stream")
        │
        ▼
5. Browser EventSource reads SSE stream
        │
        ├── type: "token"  → append to current message content
        ├── type: "source" → add to sources list (show immediately)
        └── type: "done"   → finalize message, stop streaming indicator
```

---

## Non-Streaming Request

```
POST /api/chat { "query": "..." }
      │
      ▼
AgentService.search(query)
      │
      ├── agent.ainvoke({ messages: [HumanMessage(query)] })
      ├── _extract_answer(messages) → last AIMessage content
      └── _extract_sources(messages) → deduplicated Source list
      │
      ▼
ChatResponse { query, answer, sources, session_id }
```

---

## Key Design Decisions

### Why LangGraph over legacy LangChain agents?

LangGraph is Anthropic/LangChain's production-recommended agent framework. It provides:
- Stateful graph execution (easier to reason about)
- Built-in `astream_events` for fine-grained streaming control
- Better interrupt/resume and checkpointing support (for future multi-turn memory)

### Why Server-Sent Events over WebSockets?

| Criteria | SSE | WebSocket |
|---|---|---|
| Complexity | Low (HTTP) | High (WS handshake) |
| Browser support | Native `EventSource` | Requires library |
| Direction | Server → Client only | Bidirectional |
| Use case fit | ✅ Token streaming | Overkill here |

For a chat interface where the server streams responses, SSE is the right tool.

### Why Gemini 2.5 Flash?

- Fastest Gemini model with high context window
- Supports tool calling (required for ReAct agent)
- Cost-efficient for high query volumes
- Configurable via `GOOGLE_LLM_MODEL` env var (swap to Pro easily)

### Why Tavily over Google Search API?

- Designed for AI agents (returns cleaned, structured content)
- No complex quota management
- Results include extracted content (not just links)
- Built-in `langchain-tavily` integration

---

## Observability

### Structured Logging (structlog)

Every request is logged with:
```json
{
  "event": "http_request",
  "method": "POST",
  "path": "/api/chat/stream",
  "status_code": 200,
  "duration_ms": 3241.5,
  "timestamp": "2025-10-01T12:00:00Z"
}
```

### LangSmith Tracing

When `LANGSMITH_TRACING=true`, every agent run is traced:
- Full message history
- Tool call inputs/outputs
- Token usage
- Latency per node

Access at: https://smith.langchain.com

---

## Scaling Considerations

| Concern | Current | Production Upgrade |
|---|---|---|
| Rate limiting | In-memory per-process | Redis + `limits` |
| Agent state | Stateless per request | LangGraph checkpointer + Redis |
| LLM failover | Single provider | LiteLLM for provider fallback |
| Caching | None | Semantic cache (Gemini embeddings) |
| Load balancing | Single instance | Multiple Uvicorn workers behind nginx |
| Auth | None | JWT/API key middleware |
