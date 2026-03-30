/**
 * SearchInput.tsx — Query input box with auto-grow and suggested queries
 * ─────────────────────────────────────────────────────────────────────────────
 * Features:
 *   - Auto-expanding textarea (grows up to 200px as user types)
 *   - Enter to submit, Shift+Enter for new line
 *   - Suggested query chips (shown only on the welcome screen)
 *   - Disabled + spinner while streaming is in progress
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, type KeyboardEvent } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatStatus } from '@/types'

interface SearchInputProps {
  onSubmit: (query: string) => void  // called with trimmed query text
  status: ChatStatus                  // used to disable input while streaming
  showSuggestions?: boolean           // false once a conversation has started
}

// Sample queries shown as clickable chips on the welcome screen.
// Clicking one pre-fills the input (user still has to submit).
const SUGGESTED_QUERIES = [
  'What are the latest AI breakthroughs in 2025?',
  'How does LangChain compare to other AI frameworks?',
  'Best practices for building production RAG systems',
  'Recent developments in multimodal AI models',
]

export function SearchInput({ onSubmit, status, showSuggestions = true }: SearchInputProps) {
  const [query, setQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Derived: are we currently waiting for a response?
  const isLoading = status === 'loading' || status === 'streaming'

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = () => {
    const trimmed = query.trim()
    if (!trimmed || isLoading) return  // guard: no empty submissions, no double-submit
    onSubmit(trimmed)
    setQuery('')
    // Reset textarea height after clearing (otherwise it stays tall)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter alone → submit. Shift+Enter → new line (default textarea behaviour).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()  // prevent the newline that Enter would normally insert
      handleSubmit()
    }
  }

  // ── Auto-grow handler ─────────────────────────────────────────────────────

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    // Reset height first so scrollHeight reflects the natural content height,
    // not the previously set height (which could be larger)
    el.style.height = 'auto'
    // Expand to content height, capped at 200px (then scrolls internally)
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="space-y-3">
      {/*
       * Suggested query chips — visible only on the welcome screen
       * (showSuggestions=false once messages exist).
       * Clicking a chip pre-fills the textarea but doesn't auto-submit —
       * the user reviews and hits Enter.
       */}
      {showSuggestions && (
        <div className="flex flex-wrap gap-2 justify-center">
          {SUGGESTED_QUERIES.map(q => (
            <button
              key={q}
              onClick={() => {
                setQuery(q)
                textareaRef.current?.focus()  // focus so user can edit or submit
              }}
              disabled={isLoading}
              className="text-xs text-muted-foreground border border-border/60 rounded-full px-3 py-1.5 hover:bg-muted hover:text-foreground hover:border-border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/*
       * Input box — styled card with focus ring.
       * Goes slightly transparent while loading to signal it's disabled.
       */}
      <div className={cn(
        'flex items-end gap-2 rounded-2xl border bg-card p-3 transition-all',
        'border-border/60 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20',
        isLoading && 'opacity-80',
      )}>
        {/*
         * Textarea instead of <input> so:
         *   - Users can write multi-line queries (Shift+Enter)
         *   - It can auto-grow with the content
         * rows=1 sets the initial height (CSS overrides to min-h-[24px])
         */}
        <textarea
          ref={textareaRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}   // fires synchronously on every character
          placeholder="Ask anything — I'll search the web for you..."
          disabled={isLoading}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60 leading-relaxed min-h-[24px]"
          style={{ height: 'auto' }}
        />

        {/* Send button — shows spinner while loading, arrow icon when idle */}
        <Button
          onClick={handleSubmit}
          disabled={!query.trim() || isLoading}  // disabled when empty OR streaming
          size="icon"
          className="flex-shrink-0 h-8 w-8 rounded-xl"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Keyboard shortcut hint */}
      <p className="text-center text-xs text-muted-foreground">
        Press <kbd className="px-1 py-0.5 rounded border border-border text-xs font-mono">Enter</kbd> to search · <kbd className="px-1 py-0.5 rounded border border-border text-xs font-mono">Shift+Enter</kbd> for new line
      </p>
    </div>
  )
}
