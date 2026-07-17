import React from 'react'
import { TypingIndicator } from './typing-indicator'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isLoading?: boolean
}

export function MessageBubble({ role, content, isLoading }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-accent text-accent-foreground'
            : 'bg-muted-background text-foreground'
        }`}
      >
        {isLoading ? (
          <TypingIndicator />
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </p>
        )}
      </div>
    </div>
  )
}
