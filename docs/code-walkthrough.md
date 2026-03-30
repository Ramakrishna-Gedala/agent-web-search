# Code Walkthrough — chat.py → agent_service.py

This document explains the complete flow of a request from the moment the user
sends a message to the moment a response comes back. Line by line.

---

## The Big Picture

```
User types a question in the browser
        │
        ▼
[1] chat.py        — receives the HTTP request, validates it, calls the service
        │
        ▼
[2] agent_service.py — runs the AI agent, searches the web, builds the response
        │
        ├── Gemini LLM  (thinks and writes the answer)
        └── Tavily API  (searches the real web)
        │
        ▼
Response goes back to the browser
```

There are **two modes** — streaming and non-streaming. We will walk through both.

---

## PART 1 — chat.py (The Router / Door)

Think of `chat.py` as the **front door** of the backend. It:
- Receives requests from the browser
- Validates the input
- Calls `agent_service` to do the real work
- Sends the response back

```python
router = APIRouter()
```
This creates a FastAPI router — a collection of related endpoints.
It is registered in `main.py` with a `/api` prefix, so all routes here
are accessible at `/api/...`.

---

### Endpoint 1 — POST /api/chat (Non-Streaming)

```python
@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
```

- `@router.post("/chat")` — this function runs when the browser sends
  `POST /api/chat`
- `request: ChatRequest` — FastAPI automatically reads the JSON body and
  converts it into a `ChatRequest` object (defined in `schemas.py`):
  ```python
  class ChatRequest(BaseModel):
      query: str        # the user's question
      session_id: str   # optional, for tracking
  ```
- `response_model=ChatResponse` — FastAPI will validate and serialize the
  return value as a `ChatResponse` JSON object

```python
    session_id = request.session_id or str(uuid.uuid4())
```
If the browser didn't send a `session_id`, we generate a random one using
`uuid4()`. Example: `"3f8a2c1b-4d9e-..."`. This is just for tracking — we
don't store conversations.

```python
    response = await agent_service.search(
        query=request.query, session_id=session_id
    )
    return response
```
We call `agent_service.search()` and wait (`await`) for it to finish.
When it's done, we return the full response as JSON.

**What the browser gets back:**
```json
{
  "query": "What is LangChain?",
  "answer": "## What is LangChain?\n\nLangChain is a framework...",
  "sources": [
    { "url": "https://...", "title": "...", "snippet": "..." }
  ],
  "session_id": "3f8a2c1b-..."
}
```

---

### Endpoint 2 — POST /api/chat/stream (Streaming)

```python
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
```

Same as above, but instead of waiting for the full answer, we stream it
word by word (like watching ChatGPT type).

```python
    return StreamingResponse(
        agent_service.stream_search(query=request.query),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

- `StreamingResponse(...)` — instead of returning a complete JSON object,
  FastAPI keeps the HTTP connection open and sends data in chunks as they arrive
- `agent_service.stream_search(...)` — this is a **generator function**
  (explained below). Instead of returning one big result, it `yield`s small
  pieces of data continuously
- `media_type="text/event-stream"` — this tells the browser "this is a
  Server-Sent Events (SSE) stream, keep the connection open and read each line
  as it arrives"
- `Cache-Control: no-cache` — tells the browser/proxy not to cache the stream
- `X-Accel-Buffering: no` — tells nginx (if used) not to buffer the stream
  (send each chunk immediately)

**What the browser receives (as a stream over time):**
```
data: {"type": "token", "content": "## What"}

data: {"type": "token", "content": " is"}

data: {"type": "source", "source": {"url": "https://...", "title": "..."}}

data: {"type": "token", "content": " LangChain?"}

data: {"type": "done", "sources": [...]}
```

Each `data: ...` line arrives as soon as it's ready — no waiting.

---

## PART 2 — agent_service.py (The Brain)

This is where all the AI logic lives. Let's go through it step by step.

---

### The Imports

```python
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
```

LangChain represents a conversation as a list of **message objects**:

| Class | What it represents |
|---|---|
| `HumanMessage` | A message from the user |
| `AIMessage` | A message from the LLM (Gemini) |
| `ToolMessage` | The result returned by a tool (Tavily search results) |

Think of it like a WhatsApp group chat where the LLM, the user, and the search
tool are all participants exchanging messages.

```python
from langchain_google_genai import ChatGoogleGenerativeAI
```
This is the **Gemini adapter** — it wraps Google's Gemini API so LangChain
can talk to it.

```python
from langchain_tavily import TavilySearch
```
This is the **Tavily search tool** — a pre-built tool that searches the web
and returns structured results (URL, title, content).

```python
from langgraph.prebuilt import create_react_agent
```
This creates a **ReAct agent**. ReAct stands for "Reason + Act". It is the
loop that makes the AI decide when to search vs when to answer.

---

### The System Prompt

```python
SYSTEM_PROMPT = """You are an expert AI research assistant with real-time web search capabilities.

When answering questions:
1. Search the web for accurate, up-to-date information
...
Format your responses in Markdown for better readability."""
```

This is the **instruction given to Gemini before any user question**.
It tells Gemini its role and how to behave. You can think of it as the
employee handbook given to a new hire before they start taking customer calls.

---

### The AgentService Class

```python
class AgentService:
    def __init__(self) -> None:
        self._agent = None
```

We create a class to hold the agent. `self._agent = None` means the agent
is not built yet — we build it lazily (only when first needed).

---

### _build_agent() — Building the AI Brain

```python
def _build_agent(self):
    llm = ChatGoogleGenerativeAI(
        model=settings.GOOGLE_LLM_MODEL,   # "gemini-2.5-flash"
        google_api_key=settings.GOOGLE_API_KEY,
        temperature=0.3,
    )
```

Creates the **LLM (Large Language Model)**:
- `model` — which Gemini model to use (from `.env`)
- `temperature=0.3` — controls creativity. `0` = very factual/deterministic,
  `1` = more creative. We use `0.3` because we want accurate research answers,
  not creative writing.

```python
    search_tool = TavilySearch(
        max_results=settings.TAVILY_MAX_RESULTS,   # 5
        tavily_api_key=settings.TAVILY_API_KEY,
    )
```

Creates the **search tool**:
- `max_results=5` — Tavily will return up to 5 web pages per search
- When the agent calls this tool, Tavily searches the live web and returns
  a list of results like:
  ```python
  [
      {"url": "https://...", "title": "...", "content": "..."},
      {"url": "https://...", "title": "...", "content": "..."},
      ...
  ]
  ```

```python
    return create_react_agent(
        model=llm,
        tools=[search_tool],
        prompt=SYSTEM_PROMPT,
    )
```

Creates the **ReAct agent** that connects the LLM + tools + system prompt.
The agent runs a loop:
1. Gemini **reasons**: "Do I need to search to answer this?"
2. Gemini **acts**: calls `TavilySearch("the query")`
3. Gemini **observes**: reads the search results
4. Gemini **reasons again**: "Do I have enough info?"
5. Gemini **responds**: writes the final answer

---

### The @property agent — Lazy Initialization

```python
@property
def agent(self):
    if self._agent is None:
        self._agent = self._build_agent()
    return self._agent
```

`@property` means `self.agent` behaves like a variable but runs code behind
the scenes. The first time anyone accesses `self.agent`, it builds the agent.
Every subsequent time, it returns the already-built agent.

**Why lazy?** Building the agent connects to external APIs. We don't want
that to happen at server startup — only on the first real request. This makes
startup fast and errors easier to diagnose.

---

### search() — Non-Streaming Mode

```python
async def search(self, query: str, session_id: str | None = None) -> ChatResponse:
```

`async` means this function can pause while waiting (e.g., waiting for
Gemini to respond) without blocking other requests.

```python
    result = await self.agent.ainvoke(
        {"messages": [HumanMessage(content=query)]}
    )
```

- `HumanMessage(content=query)` — wraps the user's question into the
  LangChain message format. Example: `HumanMessage(content="What is Python?")`
- `{"messages": [...]}` — this is the **agent's state**. The agent state is
  just a dictionary with a list of messages. As the agent runs, it appends
  more messages to this list (its reasoning steps, tool calls, tool results).
- `ainvoke(...)` — runs the full ReAct loop and waits until it's completely
  done, then returns the final state.

**What `result` looks like after the agent finishes:**
```python
{
    "messages": [
        HumanMessage(content="What is Python?"),
        AIMessage(tool_calls=[{"name": "TavilySearch", "args": {"query": "Python programming language"}}]),
        ToolMessage(content='[{"url": "...", "title": "...", "content": "..."}]'),
        AIMessage(content="## What is Python?\n\nPython is a high-level..."),
    ]
}
```

The full conversation history is in that `messages` list.

```python
    messages = result.get("messages", [])
    answer = self._extract_answer(messages)
    sources = self._extract_sources(messages)
```

We extract the final answer and sources from that message list (explained next).

---

### _extract_answer() — Getting the Final Text

```python
def _extract_answer(self, messages: list) -> str:
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and not getattr(msg, "tool_calls", None):
```

We loop through the messages **in reverse** (newest first) looking for:
- An `AIMessage` (a message from Gemini)
- That does NOT have `tool_calls` (meaning it's the final answer, not an
  intermediate "I'm going to search for X" message)

Why reverse? Because the last `AIMessage` without tool_calls is always
the final answer. Earlier `AIMessage`s are intermediate reasoning steps.

```python
        if isinstance(content, list):
            return " ".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
```

Gemini sometimes returns content as a **list of parts** instead of a plain
string (e.g., `[{"type": "text", "text": "Hello"}, {"type": "text", "text": " world"}]`).
We join them into one string.

---

### _extract_sources() — Getting the Web Sources

```python
def _extract_sources(self, messages: list) -> list[Source]:
    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue
```

We loop through all messages looking only for `ToolMessage` objects.
A `ToolMessage` is created by LangChain every time a tool (Tavily) finishes
running and returns results.

```python
        raw = msg.content
        if isinstance(raw, str):
            data = json.loads(raw)   # parse JSON string → Python list
        elif isinstance(raw, list):
            data = raw               # already a list, use directly
```

Tavily's results come back as either:
- A **JSON string**: `'[{"url": "...", "title": "..."}]'` — we parse it
- A **Python list**: `[{"url": "...", "title": "..."}]` — we use it directly

```python
        url = item.get("url", "").strip()
        if url and url not in seen_urls:
            seen_urls.add(url)
            sources.append(Source(url=url, title=..., snippet=...))
```

For each search result, we extract the URL, title, and a snippet of content.
`seen_urls` is a set that ensures we never add the same URL twice
(deduplication).

---

### stream_search() — Streaming Mode

This is the most complex part. Instead of waiting for everything to finish,
we send results to the browser **as they happen**.

```python
async def stream_search(self, query: str) -> AsyncGenerator[str, None]:
```

`AsyncGenerator[str, None]` means this function `yield`s strings one at a
time instead of returning a single value. FastAPI feeds each yielded string
directly to the browser over the open HTTP connection.

```python
    sources: list[dict] = []
    seen_urls: set[str] = set()
```

We collect sources during streaming too (they arrive mid-stream when Tavily
finishes searching).

---

#### The Event Loop

```python
    async for event in self.agent.astream_events(
        {"messages": [HumanMessage(content=query)]},
        version="v2",
    ):
```

Instead of `ainvoke()` (which waits for everything), we use `astream_events()`
which fires events **as each step happens**. Think of it like live sports
commentary instead of reading a match summary the next day.

`version="v2"` — the v2 event format is more detailed and is the current
recommended version.

Each `event` is a Python dictionary:
```python
{
    "event": "on_chat_model_stream",   # what happened
    "name": "ChatGoogleGenerativeAI",  # which component
    "data": { ... }                    # the actual data
}
```

```python
        kind = event.get("event", "")
```

We extract just the event type name into `kind`.

---

#### Handling Token Events

```python
        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
```

`on_chat_model_stream` fires every time Gemini generates a new word/token.
`data.chunk` is an `AIMessageChunk` — a partial message containing just
that one token.

```python
            content = getattr(chunk, "content", None)
```

`.content` on the chunk gives us the actual text. For Gemini it can be:
- A plain string: `"Latest"`
- A list of parts: `[{"type": "text", "text": "Latest"}]`

```python
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text += part.get("text", "")
```

We normalize both formats into a single plain string.

```python
            if text:
                payload = json.dumps({"type": "token", "content": text})
                yield f"data: {payload}\n\n"
```

We package the token as a JSON string and `yield` it.
`yield` sends this string immediately to the browser — the browser receives
it right now, not after the full answer is ready.

The browser receives:
```
data: {"type": "token", "content": "## Latest"}

data: {"type": "token", "content": " AI"}

data: {"type": "token", "content": " breakthroughs"}
```

The frontend appends each token to the message, creating the "typing" effect.

---

#### Handling Tool (Search) Events

```python
        elif kind == "on_tool_end":
            output = event.get("data", {}).get("output")
```

`on_tool_end` fires when Tavily finishes a web search. `data.output`
contains the list of search results.

```python
            for item in results:
                url = item.get("url", "").strip()
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    source = {"url": url, "title": ..., "snippet": ...}
                    sources.append(source)
                    payload = json.dumps({"type": "source", "source": source})
                    yield f"data: {payload}\n\n"
```

For each search result, we immediately send a `source` event to the browser.
This is why sources appear in the UI **before** the answer is done — they
arrive as soon as Tavily finishes searching, while Gemini is still writing.

---

#### The Done Event

```python
    done_payload = json.dumps({"type": "done", "sources": sources})
    yield f"data: {done_payload}\n\n"
```

After the entire `astream_events` loop finishes, we send one final `done`
event containing all sources. The browser uses this to know streaming is
complete and to finalize the message display.

---

#### Error Handling

```python
    except Exception as exc:
        logger.error("stream_error", error=str(exc))
        error_payload = json.dumps({"type": "error", "message": "An error occurred during search."})
        yield f"data: {error_payload}\n\n"
        return
```

If anything goes wrong (Gemini API down, Tavily fails, network error), we
catch the exception, send an `error` event to the browser, and stop the
generator with `return`.

---

### The Singleton

```python
# Singleton
agent_service = AgentService()
```

We create **one single instance** of `AgentService` when the module loads.
This instance is imported and used by `chat.py`. Having one instance means:
- The agent is built only once (not per request)
- The `_agent` is cached in memory after first use

---

## Complete Flow Summary

### Non-Streaming (POST /api/chat)

```
Browser sends: POST /api/chat { "query": "What is Python?" }
       │
       ▼
chat.py: chat()
  - Validates request (Pydantic)
  - Calls agent_service.search("What is Python?")
       │
       ▼
agent_service.py: search()
  - Creates HumanMessage("What is Python?")
  - Calls agent.ainvoke() — WAITS for full completion
       │
       ▼
LangGraph ReAct Loop:
  Step 1: Gemini reasons → "I should search for this"
  Step 2: Gemini calls TavilySearch("Python programming language")
  Step 3: Tavily searches web → returns 5 results
  Step 4: Gemini reads results → reasons → writes full answer
       │
       ▼
agent_service.py:
  - _extract_answer() → finds last AIMessage → gets text
  - _extract_sources() → finds ToolMessages → gets URLs
  - Returns ChatResponse(query, answer, sources)
       │
       ▼
chat.py: returns ChatResponse as JSON
       │
       ▼
Browser receives: { "answer": "...", "sources": [...] }
```

---

### Streaming (POST /api/chat/stream)

```
Browser sends: POST /api/chat/stream { "query": "What is Python?" }
       │
       ▼
chat.py: chat_stream()
  - Returns StreamingResponse (keeps connection open)
       │
       ▼
agent_service.py: stream_search()  ← this is a generator
       │
       ▼
LangGraph astream_events() fires events:

  EVENT: on_tool_start          → (we ignore this)
  EVENT: on_tool_end            → yield source event → browser shows source card
  EVENT: on_chat_model_stream   → yield token "## What"  → browser appends text
  EVENT: on_chat_model_stream   → yield token " is"      → browser appends text
  EVENT: on_chat_model_stream   → yield token " Python"  → browser appends text
  ... (hundreds of token events)
  (loop ends)
  yield done event              → browser finalizes message
       │
       ▼
HTTP connection closes
Browser has full answer + all sources displayed
```

---

## Key Concepts Recap

| Concept | Simple Explanation |
|---|---|
| `async/await` | Pause here while waiting, let other requests run in the meantime |
| `yield` | Send this piece of data now, then continue the function |
| `HumanMessage` | The user's question wrapped in LangChain format |
| `AIMessage` | Gemini's response wrapped in LangChain format |
| `ToolMessage` | Tavily's search results wrapped in LangChain format |
| `ainvoke()` | Run the agent, wait for the complete answer |
| `astream_events()` | Run the agent, emit an event for every step as it happens |
| `on_chat_model_stream` | "Gemini just generated one token, here it is" |
| `on_tool_end` | "Tavily finished searching, here are the results" |
| `StreamingResponse` | Keep the HTTP connection open, send data in chunks |
| `@property` | Build the agent only on first use, cache it after |
| Singleton | One shared `agent_service` instance for the whole app |
