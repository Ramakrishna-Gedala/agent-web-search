import { Globe, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  onClear: () => void
  hasMessages: boolean
}

export function Header({ onClear, hasMessages }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 border border-primary/20">
            <Globe className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-none">
              Agent Web Search
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Powered by Gemini + Tavily
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1">
            <Zap className="w-3 h-3 text-yellow-500" />
            <span>LangChain ReAct Agent</span>
          </div>

          {hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear chat
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
