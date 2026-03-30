/**
 * useChat.ts — React hook that manages all chat state and streaming logic
 * ─────────────────────────────────────────────────────────────────────────────
 * This hook is the "brain" of the frontend. It:
 *   - Maintains the list of messages
 *   - Tracks streaming status
 *   - Handles SSE events from the backend (tokens, sources, done, error)
 *   - Exposes sendMessage() and clearMessages() to components
 *
 * Components stay "dumb" — they just render what this hook provides.
 * All business logic lives here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback, useRef } from 'react'
import { streamChatMessage } from '@/lib/api'
import { generateId } from '@/lib/utils'
import type { Message, Source, ChatStatus } from '@/types'

export function useChat() {
  // Full list of messages displayed in the chat UI (both user and assistant)
  const [messages, setMessages] = useState<Message[]>([])

  // Current status of the chat:
  //   'idle'      → nothing happening, input is enabled
  //   'streaming' → agent is running, tokens are arriving
  //   'error'     → something went wrong
  const [status, setStatus] = useState<ChatStatus>('idle')

  // Error message shown in the error banner (null = no error)
  const [error, setError] = useState<string | null>(null)

  // abortRef is a flag to cancel mid-stream if the user clears the chat.
  // We use useRef (not useState) because we don't need a re-render when
  // it changes — it's just a mutable flag checked inside the async loop.
  const abortRef = useRef<boolean>(false)

  // ─────────────────────────────────────────────────────────────────────────
  // sendMessage — called when the user submits a query
  // ─────────────────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (query: string) => {
    // Prevent sending a new message while one is already in progress
    if (status === 'loading' || status === 'streaming') return

    setError(null)
    abortRef.current = false  // reset the abort flag for this new request

    // 1. Add the user's message to the list immediately (instant UI feedback)
    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])

    // 2. Add a placeholder assistant message right away.
    //    content is empty initially — tokens will be appended as they stream in.
    //    isStreaming: true → MessageBubble shows the loading/typing indicator
    const assistantId = generateId()  // stable ID to identify this message in updates
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',       // starts empty, filled token-by-token
      sources: [],       // starts empty, filled as Tavily results arrive
      isStreaming: true, // triggers the typing indicator in MessageBubble
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, assistantMsg])
    setStatus('streaming')

    try {
      // sources accumulates as source events arrive.
      // We keep a local copy here so we can pass the complete list to
      // the 'done' event handler even before it arrives.
      const sources: Source[] = []

      // Iterate over the SSE event stream from the backend.
      // Each `event` is one parsed JSON object from a "data: {...}" line.
      for await (const event of streamChatMessage(query)) {
        // Check abort flag — set by clearMessages() if user cleared the chat
        if (abortRef.current) break

        if (event.type === 'token' && event.content) {
          // A new token (word/piece) arrived — append it to the message content.
          // setMessages with a function (prev => ...) is important here:
          // it reads the latest state to avoid race conditions with rapid updates.
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: m.content + event.content }  // append token
                : m,
            ),
          )
        } else if (event.type === 'source' && event.source) {
          // A web source arrived (from Tavily) — add it to the sources list.
          // Sources typically arrive before the full answer is ready, so they
          // appear in the UI while the text is still streaming.
          sources.push(event.source)
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, sources: [...sources] }  // update sources array
                : m,
            ),
          )
        } else if (event.type === 'done') {
          // Streaming complete — finalize the message.
          // Use the sources from the done event if provided (authoritative),
          // otherwise fall back to the locally accumulated sources array.
          const finalSources = event.sources ?? sources
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, isStreaming: false, sources: finalSources }
                : m,
            ),
          )
        } else if (event.type === 'error') {
          // The backend sent an error event — throw it so the catch block handles it
          throw new Error(event.message ?? 'Stream error')
        }
      }
    } catch (err) {
      // Handle both network errors and backend error events
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
      // Update the assistant message to show an error state
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? {
                ...m,
                // Keep partial content if some tokens arrived before the error
                content: m.content || 'Sorry, an error occurred. Please try again.',
                isStreaming: false,
              }
            : m,
        ),
      )
    } finally {
      // Always runs — whether success, error, or abort.
      // Ensures status and isStreaming are always reset.
      setStatus('idle')
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m,
        ),
      )
    }
  }, [status])

  // ─────────────────────────────────────────────────────────────────────────
  // clearMessages — resets the entire chat
  // ─────────────────────────────────────────────────────────────────────────

  const clearMessages = useCallback(() => {
    // Signal the streaming loop to stop (checked via abortRef.current)
    abortRef.current = true
    setMessages([])
    setError(null)
    setStatus('idle')
  }, [])

  // Return everything components need
  return { messages, status, error, sendMessage, clearMessages }
}
