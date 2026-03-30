export function LoadingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      <span className="text-xs text-muted-foreground mr-1">Searching the web</span>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  )
}
