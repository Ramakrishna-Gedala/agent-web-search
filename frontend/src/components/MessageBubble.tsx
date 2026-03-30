/**
 * MessageBubble.tsx — Renders a single chat message (user or assistant)
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles two roles:
 *   'user'      → right-aligned blue bubble, plain text
 *   'assistant' → left-aligned card, Markdown-rendered content + source cards
 *
 * The assistant bubble has three visual states:
 *   1. isStreaming + no content  → shows LoadingIndicator (dots animation)
 *   2. isStreaming + has content → shows text + blinking cursor
 *   3. not streaming             → shows final text + sources grid
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { User, Globe } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'   // enables tables, strikethrough, etc.
import { formatTimestamp } from '@/lib/utils'
import { SourceCard } from './SourceCard'
import { LoadingIndicator } from './LoadingIndicator'
import type { Message } from '@/types'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isStreaming = message.isStreaming  // true while tokens are still arriving

  // ── User message ────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      // Right-aligned, fade in on mount
      <div className="flex justify-end gap-3 animate-fade-in">
        <div className="max-w-[80%]">
          {/* Blue bubble — plain text, no Markdown needed for user messages */}
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
            {message.content}
          </div>
          <p className="text-xs text-muted-foreground mt-1 text-right pr-1">
            {formatTimestamp(message.timestamp)}
          </p>
        </div>
        {/* User avatar */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
          <User className="w-4 h-4 text-primary" />
        </div>
      </div>
    )
  }

  // ── Assistant message ────────────────────────────────────────────────────────
  return (
    <div className="flex gap-3 animate-fade-in">
      {/* AI avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center mt-0.5">
        <Globe className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Answer card */}
        <div className="bg-card border border-border/60 rounded-2xl rounded-tl-sm px-4 py-3">
          {isStreaming && !message.content ? (
            // State 1: streaming started but no tokens yet → show loading dots
            <LoadingIndicator />
          ) : (
            <div className="prose-dark text-sm">
              {/*
               * ReactMarkdown renders the answer as HTML.
               * remarkGfm adds GitHub Flavored Markdown support:
               *   - tables, strikethrough, task lists, autolinks
               * The answer grows token-by-token — React re-renders on each
               * content update, which is why we see the typing effect.
               */}
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>

              {/* State 2: streaming + has content → show blinking cursor */}
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {/*
         * Sources grid — shown when at least one source is available.
         * Sources arrive from the backend DURING streaming (before the answer
         * is done), so this section can appear while text is still typing.
         */}
        {message.sources && message.sources.length > 0 && (
          <div className="mt-3">
            {/* Source count label */}
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
              {message.sources.length} source{message.sources.length !== 1 ? 's' : ''}
            </p>
            {/* 2-column grid of clickable source cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {message.sources.map((source, i) => (
                <SourceCard key={source.url} source={source} index={i} />
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-1.5 pl-1">
          {formatTimestamp(message.timestamp)}
        </p>
      </div>
    </div>
  )
}
