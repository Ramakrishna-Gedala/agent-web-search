export interface Source {
  url: string
  title: string
  snippet: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  isStreaming?: boolean
  timestamp: Date
}

export interface ChatResponse {
  query: string
  answer: string
  sources: Source[]
  session_id: string | null
}

export interface StreamEvent {
  type: 'token' | 'source' | 'done' | 'error'
  content?: string
  source?: Source
  sources?: Source[]
  message?: string
}

export type ChatStatus = 'idle' | 'loading' | 'streaming' | 'error'
