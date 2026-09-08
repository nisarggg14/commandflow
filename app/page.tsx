'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatSidebar } from '@/components/chat-sidebar'
import { TopBar } from '@/components/top-bar'
import { ChatInput } from '@/components/chat-input'
import { MessageBubble } from '@/components/message-bubble'
import { EmptyState } from '@/components/empty-state'
import { CommandExecutionCard, type CommandExecutionPayload } from '@/components/command-execution-card'

interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  company?: {
    id: string
    name: string
  }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
}

function parseExecutionPayload(content: string): CommandExecutionPayload | null {
  try {
    const parsed = JSON.parse(content) as CommandExecutionPayload
    return parsed && typeof parsed === 'object' && 'type' in parsed ? parsed : null
  } catch {
    return null
  }
}

type UiControl =
  | { type: 'ui-control'; action: 'getTheme' }
  | { type: 'ui-control'; action: 'setTheme'; theme: 'light' | 'dark' | 'system' }
  | { type: 'ui-control'; action: 'setBackground'; background: 'obsidian' | 'paper' | 'mist' }
  | { type: 'ui-control'; action: 'setAccentColor'; accent: 'mint' | 'sky' | 'amber' }

function applyUiControl(value: unknown) {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'ui-control') return

  const control = value as UiControl
  const root = document.documentElement

  if (control.action === 'setTheme') {
    root.classList.toggle('dark', control.theme === 'dark')
    root.classList.toggle('light', control.theme === 'light')
    if (control.theme === 'system') root.classList.remove('dark', 'light')
  }

  if (control.action === 'setBackground') {
    const backgrounds = { obsidian: '#0a0a0a', paper: '#f7f5ef', mist: '#e8f0f2' } as const
    root.style.setProperty('--background', backgrounds[control.background])
  }

  if (control.action === 'setAccentColor') {
    const accents = { mint: '#10a37f', sky: '#0284c7', amber: '#d97706' } as const
    const accent = accents[control.accent]
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--ring', accent)
    root.style.setProperty('--primary', accent)
  }
}

export default function Page() {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ||
    conversations[0]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [activeConversation?.messages])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const loadUser = async () => {
      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      })

      if (!res.ok) {
        router.push('/login')
        return
      }

      const data = await res.json()
      setAuthUser(data.user)
    }

    void loadUser()
    void handleNewChat()
  }, [router])

  const handleNewChat = async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        title: 'New Conversation',
      }),
    })

    const data = await res.json()

    const conversation: Conversation = {
      id: data.id,
      title: data.title,
      messages: [],
    }

    setConversations((prev) => [...prev, conversation])
    setActiveConversationId(conversation.id)
  }

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id)
    setSidebarOpen(false)
  }

  const handleSendMessage = async (message: string) => {
    if (!activeConversationId) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversationId
          ? {
              ...c,
              messages: [...c.messages, userMessage],
            }
          : c
      )
    )

    setIsLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        conversationId: activeConversationId,
        message,
      }),
    })

    const data = await res.json()

    setIsLoading(false)

    if (!data.success) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || 'The command could not be completed.',
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages: [...c.messages, errorMessage] }
            : c
        )
      )
      return
    }

    try {
      const payload = JSON.parse(data.response) as CommandExecutionPayload
      applyUiControl(payload.data)
    } catch {
      // Render malformed or non-command responses as normal assistant content.
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: data.response,
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversationId
          ? {
              ...c,
              messages: [...c.messages, assistantMessage],
            }
          : c
      )
    )
  }

  const handleSuggestionClick = (suggestion: string) => {
    handleSendMessage(suggestion)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ChatSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
      />

      <div className="flex flex-col flex-1 w-full md:w-0">
        <TopBar title={activeConversation?.title || 'CommandFlow'} user={authUser} />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
            {!activeConversation ||
            activeConversation.messages.length === 0 ? (
              <EmptyState onSuggestionClick={handleSuggestionClick} role={authUser?.role} />
            ) : (
              <div className="space-y-6">
                {activeConversation.messages.map((msg) => {
                  if (msg.role === 'assistant') {
                    const payload = parseExecutionPayload(msg.content)

                    if (payload) {
                      return (
                        <div key={msg.id} className="flex justify-start">
                          <div className="w-full max-w-3xl">
                            <CommandExecutionCard payload={payload} />
                          </div>
                        </div>
                      )
                    }
                  }

                  return (
                    <MessageBubble
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                    />
                  )
                })}

                {isLoading && (
                  <MessageBubble
                    role="assistant"
                    content=""
                    isLoading={true}
                  />
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <ChatInput
          onSubmit={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
