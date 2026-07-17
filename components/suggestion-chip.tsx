interface SuggestionChipProps {
  text: string
  onClick: () => void
}

export function SuggestionChip({ text, onClick }: SuggestionChipProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-muted-background px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-secondary hover:border-accent hover:text-foreground"
    >
      <span>•</span>
      <span>{text}</span>
    </button>
  )
}
