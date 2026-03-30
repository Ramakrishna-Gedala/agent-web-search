/**
 * App.tsx — Root component
 * ─────────────────────────────────────────────────────────────────────────────
 * The top-level component that wires everything together:
 *   - useChat()       → all state and logic (messages, status, streaming)
 *   - Header          → top bar with title and "Clear chat" button
 *   - ChatInterface   → message list + input box
 *
 * This component intentionally contains no logic — it just connects the
 * hook's state/actions to the UI components (separation of concerns).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Header } from '@/components/Header'
import { ChatInterface } from '@/components/ChatInterface'
import { useChat } from '@/hooks/useChat'

export default function App() {
  // useChat manages all state: messages list, streaming status, errors
  // sendMessage() → sends query to backend and handles the SSE stream
  // clearMessages() → resets the chat
  const { messages, status, error, sendMessage, clearMessages } = useChat()

  return (
    // Full viewport height, flex column so header + main stack vertically
    <div className="flex flex-col h-screen bg-background overflow-hidden">

      {/* Sticky top bar — shows title, tech badge, and clear button */}
      <Header onClear={clearMessages} hasMessages={messages.length > 0} />

      {/* Main content area — fills remaining height, handles its own scroll */}
      <main className="flex-1 overflow-hidden">
        <ChatInterface
          messages={messages}        // array of user + assistant messages
          status={status}            // 'idle' | 'streaming' | 'error'
          error={error}              // error message string or null
          onSendMessage={sendMessage} // called when user submits a query
        />
      </main>
    </div>
  )
}
