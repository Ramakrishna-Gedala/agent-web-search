/**
 * api.ts — HTTP client for the backend API
 * ─────────────────────────────────────────────────────────────────────────────
 * Exports two functions:
 *   sendChatMessage()   → regular fetch, waits for full JSON response
 *   streamChatMessage() → async generator, yields SSE events one by one
 *
 * All requests go to /api/* — Vite proxies this to http://localhost:8000
 * (configured in vite.config.ts). No CORS issues in development.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ChatResponse, StreamEvent } from '@/types'

const API_BASE = '/api'

// ─────────────────────────────────────────────────────────────────────────────
// Non-Streaming: POST /api/chat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a query and wait for the complete response (blocking).
 * The server runs the full agent loop before responding.
 */
export async function sendChatMessage(query: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    // Try to extract the error detail from the JSON body
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  return response.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming: POST /api/chat/stream
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a query and receive the response token-by-token as Server-Sent Events.
 *
 * This is an async generator — it `yield`s one StreamEvent at a time.
 *
 * Usage:
 *   for await (const event of streamChatMessage("What is Python?")) {
 *     if (event.type === 'token')  appendText(event.content)
 *     if (event.type === 'source') addSource(event.source)
 *     if (event.type === 'done')   finalize()
 *   }
 *
 * SSE wire format sent by the server:
 *   data: {"type": "token",  "content": "Hello "}\n\n
 *   data: {"type": "source", "source": {url, title, snippet}}\n\n
 *   data: {"type": "done",   "sources": [...]}\n\n
 *
 * We read the raw byte stream, decode it, split on "\n\n" (event boundaries),
 * strip the "data: " prefix, parse JSON, and yield the typed event object.
 */
export async function* streamChatMessage(
  query: string,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  // response.body is a ReadableStream<Uint8Array> — raw bytes
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder() // converts bytes → UTF-8 string

  // buffer holds partial data between reads.
  // Network chunks are arbitrary-sized — an SSE event ("\n\n" boundary) may
  // arrive split across two reads. Buffer keeps the incomplete tail.
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break // server closed the connection

      // stream:true keeps the decoder's internal state for multi-byte chars
      // that might be split across chunk boundaries
      buffer += decoder.decode(value, { stream: true })

      // SSE events end with double newline "\n\n" — split on that
      const lines = buffer.split('\n\n')

      // The last item may be incomplete (no trailing "\n\n" yet) — keep it
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const dataLine = line.trim()
        if (!dataLine.startsWith('data: ')) continue // skip non-data lines

        const jsonStr = dataLine.slice(6) // remove "data: " prefix
        try {
          const event: StreamEvent = JSON.parse(jsonStr)
          yield event // deliver the parsed event to the caller immediately
        } catch {
          // skip lines that aren't valid JSON (e.g. SSE comments ":")
        }
      }
    }
  } finally {
    // Always release the lock — prevents memory leaks even if an error occurs
    reader.releaseLock()
  }
}
