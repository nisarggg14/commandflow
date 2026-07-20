'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatSidebar } from '@/components/chat-sidebar'
import { TopBar } from '@/components/top-bar'
import { ChatInput } from '@/components/chat-input'
import { MessageBubble } from '@/components/message-bubble'
import { EmptyState } from '@/components/empty-state'

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

export default function Page() {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [isLoading, setIsLoading] = useState(false)

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

    const token = localStorage.getItem('token')

    if (!token) {
      router.push('/login')
      return
    }

    handleNewChat()
  }, [router])

  const handleNewChat = async () => {
    const token = localStorage.getItem('token')

    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
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

    const token = localStorage.getItem('token')

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        conversationId: activeConversationId,
        message,
      }),
    })

    const data = await res.json()

    setIsLoading(false)

    if (!data.success) return

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
      <TopBar title={activeConversation?.title || 'CommandFlow'} />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
          {!activeConversation ||
          activeConversation.messages.length === 0 ? (
            <EmptyState onSuggestionClick={handleSuggestionClick} />
          ) : (
            <div className="space-y-6">
              {activeConversation.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                />
              ))}

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