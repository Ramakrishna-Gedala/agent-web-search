import { ExternalLink } from 'lucide-react'
import { getDomainFromUrl } from '@/lib/utils'
import type { Source } from '@/types'

interface SourceCardProps {
  source: Source
  index: number
}

export function SourceCard({ source, index }: SourceCardProps) {
  const domain = getDomainFromUrl(source.url)

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-1 p-3 rounded-lg border border-border/60 bg-card/50 hover:bg-card hover:border-border transition-all duration-200 text-left no-underline"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium flex items-center justify-center">
            {index + 1}
          </span>
          <span className="text-xs font-medium text-muted-foreground truncate">
            {domain}
          </span>
        </div>
        <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {source.title && (
        <p className="text-xs font-medium text-foreground line-clamp-1 pl-7">
          {source.title}
        </p>
      )}

      {source.snippet && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-7">
          {source.snippet}
        </p>
      )}
    </a>
  )
}
