import { useEffect, useRef } from 'react'
import { Bot, Sparkles } from 'lucide-react'
import { MessageBubble } from './MessageBubble'
import { SearchInput } from './SearchInput'
import type { Message, ChatStatus } from '@/types'

interface ChatInterfaceProps {
  messages: Message[]
  status: ChatStatus
  error: string | null
  onSendMessage: (query: string) => void
}

function WelcomeScreen() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 py-16 text-center">
      <div className="space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">
            What would you like to know?
          </h2>
          <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
            I'm an AI research assistant that searches the web in real-time using{' '}
            <span className="text-foreground font-medium">Tavily</span> and synthesizes
            answers with <span className="text-foreground font-medium">Gemini</span>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg">
        {[
          { icon: '🔍', label: 'Real-time web search' },
          { icon: '🧠', label: 'AI reasoning & synthesis' },
          { icon: '📚', label: 'Cited sources' },
        ].map(({ icon, label }) => (
          <div
            key={label}
            className="flex items-center gap-2.5 p-3 rounded-xl border border-border/60 bg-card/50 text-sm text-muted-foreground"
          >
            <span className="text-base">{icon}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChatInterface({
  messages,
  status,
  error,
  onSendMessage,
}: ChatInterfaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const hasMessages = messages.length > 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full px-4">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-6">
        {!hasMessages ? (
          <WelcomeScreen />
        ) : (
          <div className="space-y-6 pb-4">
            {messages.map(message => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-3 px-4 py-2.5 rounded-xl border border-destructive/30 bg-destructive/10 text-sm text-destructive flex items-center gap-2">
          <Bot className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="pb-6 pt-2">
        <SearchInput onSubmit={onSendMessage} status={status} showSuggestions={!hasMessages} />
      </div>
    </div>
  )
}
