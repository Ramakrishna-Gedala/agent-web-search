# AI Web Search Agent (LangChain + Gemini + Tavily) | Real-Time LLM Search Engine

## AI Web Search Agent using LangChain, Gemini, and Tavily

This project is a **production-grade AI web search agent** that uses a LangChain ReAct agent to perform real-time web searches and generate synthesized, cited answers using LLMs.

It demonstrates how to build an **AI-powered search engine** with:
- Real-time web search (Tavily)
- LLM reasoning (Google Gemini)
- Streaming responses (SSE)
- Full-stack architecture (FastAPI + React)

This project is designed for engineers exploring **LLM agents, AI systems, and real-world AI applications**.

> An AI-powered web search agent that delivers synthesized, cited answers in real time.

![Agent Web Search Demo](docs/assets/demo-placeholder.png)

---

## Overview

**Agent Web Search** is a full-stack AI application that combines a **LangChain ReAct agent**, **Google Gemini**, and **Tavily real-time web search** to answer any question with up-to-date information and cited sources.

Built as a production-grade showcase of AI engineering, system design, and full-stack development.

---

## Features

- **Real-time web search** — Tavily API fetches live results for every query
- **AI reasoning** — LangChain ReAct agent iteratively decides what to search and how to synthesize results
- **Streaming responses** — Server-Sent Events stream tokens as they're generated
- **Structured output** — Every response includes the answer + cited sources
- **Clean chat UI** — ChatGPT-style interface with Markdown rendering
- **Production-ready** — Rate limiting, structured logging, CORS, error handling
- **LangSmith tracing** — Full agent trace visibility (optional)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| **Backend** | Python 3.11+, FastAPI, Uvicorn |
| **AI Agent** | LangChain, LangGraph (ReAct agent) |
| **LLM** | Google Gemini 2.5 Flash |
| **Search** | Tavily Search API |
| **Observability** | LangSmith, structlog |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Browser                             │
│                   React + Tailwind + shadcn                     │
└────────────────────────┬────────────────────────────────────────┘
                         │ POST /api/chat/stream (SSE)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Gateway                              │
│           CORS · Rate Limiting · Request Logging               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Agent Service Layer                           │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │              LangGraph ReAct Agent                      │  │
│   │                                                         │  │
│   │   User Query → [Reason] → [Tool Call] → [Reason] → ... │  │
│   └─────────────────┬───────────────────────────────────────┘  │
│                     │                                           │
│         ┌───────────┴───────────┐                              │
│         ▼                       ▼                              │
│   ┌───────────┐         ┌──────────────┐                       │
│   │  Gemini   │         │    Tavily    │                       │
│   │  2.5 Flash│         │  Search API  │                       │
│   │   (LLM)   │         │ (Web Search) │                       │
│   └───────────┘         └──────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LangSmith (optional)                         │
│              Full agent trace observability                     │
└─────────────────────────────────────────────────────────────────┘
```

**Request flow:**
1. User types a query → React sends `POST /api/chat/stream`
2. FastAPI validates, rate-limits, and routes to `AgentService`
3. LangGraph ReAct agent reasons: decides to call `TavilySearch`
4. Tavily returns real-time web results
5. Gemini synthesizes results into a structured Markdown answer
6. Tokens stream back via SSE; sources appear as they're found
7. Frontend renders Markdown + clickable source cards

---

## Project Structure

```
agent-web-search/
├── backend/                    # FastAPI + LangChain backend
│   ├── app/
│   │   ├── main.py             # FastAPI app & middleware setup
│   │   ├── config.py           # Pydantic settings from .env
│   │   ├── api/
│   │   │   └── routes/
│   │   │       └── chat.py     # POST /api/chat & /api/chat/stream
│   │   ├── services/
│   │   │   └── agent_service.py  # LangChain ReAct agent
│   │   ├── models/
│   │   │   └── schemas.py      # Pydantic request/response models
│   │   └── core/
│   │       ├── logging.py      # Structured logging (structlog)
│   │       └── middleware.py   # Rate limiting, request logging
│   ├── requirements.txt
│   ├── pyproject.toml
│   └── .env.example
│
├── frontend/                   # React + Vite frontend
│   ├── src/
│   │   ├── App.tsx             # Root component
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx   # Main chat layout
│   │   │   ├── MessageBubble.tsx   # User/AI message bubbles
│   │   │   ├── SearchInput.tsx     # Query input + suggestions
│   │   │   ├── SourceCard.tsx      # Clickable source cards
│   │   │   ├── LoadingIndicator.tsx
│   │   │   ├── Header.tsx
│   │   │   └── ui/             # shadcn/ui primitives
│   │   ├── hooks/
│   │   │   └── useChat.ts      # Chat state + streaming logic
│   │   ├── lib/
│   │   │   ├── api.ts          # Fetch + SSE stream client
│   │   │   └── utils.ts        # Helpers
│   │   └── types/
│   │       └── index.ts        # TypeScript interfaces
│   ├── package.json
│   ├── vite.config.ts          # Dev proxy → backend
│   └── tailwind.config.js
│
├── docs/
│   ├── architecture.md         # Detailed architecture docs
│   └── api.md                  # API reference
│
└── README.md
```

---

## Setup Instructions

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- API keys:
  - [Google AI Studio](https://aistudio.google.com) — Gemini API key
  - [Tavily](https://tavily.com) — Search API key
  - [LangSmith](https://smith.langchain.com) — *(optional)* Tracing

---

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your API keys

# Run the server
uvicorn app.main:app --reload --port 8000
```

API will be available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health check**: http://localhost:8000/api/health

---

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend will be available at **http://localhost:5173**

> The Vite dev server proxies `/api` requests to `http://localhost:8000` automatically.

---

### Environment Variables

Copy `backend/.env.example` to `backend/.env`:

```env
# Google / Gemini
GOOGLE_API_KEY=your_google_api_key
GOOGLE_LLM_MODEL=gemini-2.5-flash

# Tavily Search
TAVILY_API_KEY=your_tavily_api_key
TAVILY_MAX_RESULTS=5

# LangSmith (optional tracing)
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=agent-web-search

# App settings
DEBUG=false
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_PERIOD=60
```

---

## API Reference

### `POST /api/chat`

Non-streaming chat endpoint.

**Request:**
```json
{
  "query": "What are the latest AI breakthroughs in 2025?",
  "session_id": "optional-uuid"
}
```

**Response:**
```json
{
  "query": "What are the latest AI breakthroughs in 2025?",
  "answer": "## Latest AI Breakthroughs in 2025\n\n...",
  "sources": [
    {
      "url": "https://example.com/article",
      "title": "AI Breakthroughs 2025",
      "snippet": "In 2025, researchers announced..."
    }
  ],
  "session_id": "abc-123"
}
```

### `POST /api/chat/stream`

Streaming SSE endpoint. Yields Server-Sent Events:

```
data: {"type": "token", "content": "## Latest"}
data: {"type": "source", "source": {"url": "...", "title": "...", "snippet": "..."}}
data: {"type": "done", "sources": [...]}
```

### `GET /api/health`

```json
{ "status": "ok", "version": "1.0.0", "service": "Agent Web Search" }
```

Full API docs: [docs/api.md](docs/api.md)

---

## Development

### Backend

```bash
# Run with auto-reload
uvicorn app.main:app --reload

# Run tests
pytest

# Format & lint
ruff check . --fix
black .
```

### Frontend

```bash
# Dev server
npm run dev

# Type check + build
npm run build

# Lint
npm run lint
```

---

## How It Works — Agent Deep Dive

The core is a **LangGraph ReAct agent** that follows the Reason → Act → Observe loop:

```
Query: "What happened at Google I/O 2025?"

1. [REASON]  I need current information about Google I/O 2025.
2. [ACT]     TavilySearch("Google I/O 2025 announcements")
3. [OBSERVE] [results from Tavily: 5 web pages with content]
4. [REASON]  I have enough information. Let me synthesize a response.
5. [RESPOND] "## Google I/O 2025 Highlights\n\n..."
```

Each tool call returns structured results including URL, title, and content. These are extracted, deduplicated, and returned alongside the answer as clickable source cards.

---

## License

MIT

---

*Built to demonstrate AI engineering, system design, and full-stack development capabilities.*
