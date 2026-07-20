import { SuggestionChip } from './suggestion-chip'

interface EmptyStateProps {
  onSuggestionClick: (text: string) => void
}

export function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  const suggestions = [
    'Show products',
    'Update stock',
    'Reduce prices',
    'Show pending orders',
    'Disable employee',
    'List applications',
  ]

  return (
    <div className="flex flex-col items-center justify-center min-h-full gap-8 px-4 py-16">
      {/* Header */}
      <div className="text-center space-y-3 max-w-2xl">
        <h1 className="text-4xl md:text-5xl font-bold text-foreground">
          CommandFlow
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground font-light">
          Enterprise AI Operating System
        </p>
        <p className="text-muted-foreground">
          Control your business using natural language.
        </p>
      </div>

      {/* Suggestions */}
      <div className="w-full max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {suggestions.map((suggestion, index) => (
            <SuggestionChip
              key={index}
              text={suggestion}
              onClick={() => onSuggestionClick(suggestion)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
