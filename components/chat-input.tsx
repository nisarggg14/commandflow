'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Paperclip, Mic } from 'lucide-react'

interface ChatInputProps {
  onSubmit: (message: string) => void
  isLoading?: boolean
  placeholder?: string
}

export function ChatInput({
  onSubmit,
  isLoading = false,
  placeholder = 'Ask CommandFlow anything...',
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const [rows, setRows] = useState(1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const scrollHeight = textareaRef.current.scrollHeight
      const newRows = Math.min(Math.ceil(scrollHeight / 24), 6)
      setRows(newRows)
      textareaRef.current.style.height = 'auto'
    }
  }, [input])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isLoading) {
      onSubmit(input.trim())
      setInput('')
      setRows(1)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-border bg-background p-4"
    >
      <div className="mx-auto max-w-4xl">
        <div className="flex gap-3 rounded-xl border border-border bg-muted-background p-4">
          {/* Attach File Button */}
          <button
            type="button"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          {/* Text Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={rows}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-foreground placeholder-muted-foreground outline-none"
          />

          {/* Action Buttons */}
          <div className="flex items-end gap-2 flex-shrink-0">
            {/* Voice Button */}
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Voice input (placeholder)"
            >
              <Mic className="h-5 w-5" />
            </button>

            {/* Send Button */}
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-lg bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-accent-foreground p-2 transition-colors"
              title="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Footer Note */}
        <p className="text-xs text-muted-foreground text-center mt-3">
          CommandFlow can make mistakes. Please verify important information.
        </p>
      </div>
    </form>
  )
}
