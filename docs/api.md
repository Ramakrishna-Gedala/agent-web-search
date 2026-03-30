# API Reference — Agent Web Search

Base URL: `http://localhost:8000`

Interactive docs: [http://localhost:8000/docs](http://localhost:8000/docs) (Swagger UI)

---

## Endpoints

### `GET /`

Root endpoint — service info.

**Response `200`:**
```json
{
  "service": "Agent Web Search",
  "version": "1.0.0",
  "docs": "/docs"
}
```

---

### `GET /api/health`

Health check / liveness probe.

**Response `200`:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "service": "Agent Web Search"
}
```

---

### `POST /api/chat`

Invoke the search agent. Blocks until the full response is ready, then returns a structured JSON response.

**Request body:**
```json
{
  "query": "string (1–2000 chars, required)",
  "session_id": "string (optional UUID)"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | The user's search question |
| `session_id` | string | No | Client-provided session ID for tracking |

**Response `200`:**
```json
{
  "query": "What are the latest AI breakthroughs in 2025?",
  "answer": "## Latest AI Breakthroughs in 2025\n\nBased on current web sources...",
  "sources": [
    {
      "url": "https://example.com/ai-2025",
      "title": "Top AI Innovations in 2025",
      "snippet": "Researchers announced a breakthrough in..."
    }
  ],
  "session_id": "3f8a2c1b-..."
}
```

| Field | Type | Description |
|---|---|---|
| `query` | string | The original query |
| `answer` | string | Markdown-formatted synthesized answer |
| `sources` | Source[] | Cited web sources |
| `session_id` | string | Session identifier |

**Source object:**

| Field | Type | Description |
|---|---|---|
| `url` | string | Full URL of the source page |
| `title` | string | Page title |
| `snippet` | string | Brief content excerpt (≤250 chars) |

**Error responses:**

| Status | Condition |
|---|---|
| `422` | Invalid request body (query too long, etc.) |
| `429` | Rate limit exceeded (10 req/60s) |
| `500` | Agent or LLM error |

---

### `POST /api/chat/stream`

Same as `/api/chat` but streams the response as **Server-Sent Events (SSE)**.

**Request body:** Same as `/api/chat`

**Response:** `text/event-stream`

The stream yields events in this format:
```
data: <json>\n\n
```

#### Event Types

**`token`** — A chunk of the answer text (stream as they arrive):
```json
{ "type": "token", "content": "## Latest AI" }
```

**`source`** — A web source found during search (can arrive before the answer is complete):
```json
{
  "type": "source",
  "source": {
    "url": "https://example.com",
    "title": "Article Title",
    "snippet": "Relevant excerpt..."
  }
}
```

**`done`** — Stream complete. Includes final sources list:
```json
{
  "type": "done",
  "sources": [
    { "url": "...", "title": "...", "snippet": "..." }
  ]
}
```

**`error`** — An error occurred during processing:
```json
{ "type": "error", "message": "An error occurred during search." }
```

#### Client-side Example (JavaScript)

```javascript
const response = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'Your question here' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));

    if (event.type === 'token') {
      process.stdout.write(event.content); // accumulate text
    } else if (event.type === 'source') {
      console.log('Source:', event.source.url);
    } else if (event.type === 'done') {
      console.log('Stream complete');
    }
  }
}
```

#### cURL Example

```bash
curl -N -X POST http://localhost:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"query": "What is LangChain used for?"}'
```

---

## Rate Limiting

All `/api/chat*` endpoints are rate-limited:

- **10 requests per 60 seconds** per IP address
- Sliding window algorithm (in-memory)
- Rate-limited responses return `HTTP 429`

**429 response:**
```json
{
  "detail": "Rate limit exceeded. Max 10 requests per 60s."
}
```

---

## Error Codes

| Code | Meaning |
|---|---|
| `200` | Success |
| `422` | Validation error — check request body |
| `429` | Rate limit exceeded |
| `500` | Internal server error (LLM/search API failure) |
