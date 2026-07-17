'use client'

import { useState, useRef, useEffect } from 'react'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: '1',
      title: 'Q2 Sales Analysis',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Show me the Q2 sales report',
        },
        {
          id: 'm2',
          role: 'assistant',
          content:
            'Q2 2024 Sales Report:\n\n• Total Revenue: $2.4M (↑18% YoY)\n• Units Sold: 48,500 (↑12% YoY)\n• Top Product: Enterprise Suite ($1.2M)\n• Top Region: North America ($1.6M)\n\nKey Insights:\n- Enterprise segment grew 22% YoY\n- SMB segment stable at previous levels\n- International expansion gaining traction',
        },
      ],
    },
    {
      id: '2',
      title: 'Inventory Planning',
      messages: [],
    },
  ])
  const [activeConversationId, setActiveConversationId] = useState('1')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  ) || conversations[0]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [activeConversation.messages])

  const handleNewChat = () => {
    const newId = String(Date.now())
    const newConversation: Conversation = {
      id: newId,
      title: 'New Conversation',
      messages: [],
    }
    setConversations([...conversations, newConversation])
    setActiveConversationId(newId)
  }

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id)
    setSidebarOpen(false)
  }

  const handleSendMessage = async (message: string) => {
    // Add user message
    const newUserMessage: Message = {
      id: String(Date.now()),
      role: 'user',
      content: message,
    }

    const updatedConversations = conversations.map((conv) =>
      conv.id === activeConversationId
        ? { ...conv, messages: [...conv.messages, newUserMessage] }
        : conv
    )
    setConversations(updatedConversations)
    setIsLoading(true)

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        'I understand. Let me analyze that for you. The data shows interesting trends that we should discuss further.',
        'Based on your request, here are the key metrics: Revenue is up 18% YoY, and customer retention improved by 12%. Would you like more details?',
        'That\'s a great question. The current inventory levels are optimal for Q3, with a 4-week buffer maintained across all SKUs.',
        'I\'ve processed your request. The report is ready. Total revenue for the period is $2.4M with strong growth in the enterprise segment.',
      ]

      const randomResponse =
        responses[Math.floor(Math.random() * responses.length)]

      const newAssistantMessage: Message = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: randomResponse,
      }

      const updatedConversations2 = updatedConversations.map((conv) =>
        conv.id === activeConversationId
          ? { ...conv, messages: [...conv.messages, newAssistantMessage] }
          : conv
      )
      setConversations(updatedConversations2)
      setIsLoading(false)
    }, 1500)

    // Update conversation title if it's still default
    const updatedConversations3 = updatedConversations.map((conv) =>
      conv.id === activeConversationId && conv.title === 'New Conversation'
        ? {
            ...conv,
            title:
              message.length > 30
                ? message.substring(0, 30) + '...'
                : message,
          }
        : conv
    )
    setConversations(updatedConversations3)
  }

  const handleSuggestionClick = (suggestion: string) => {
    handleSendMessage(suggestion)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <ChatSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
      />

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 w-full md:w-0">
        {/* Top Bar */}
        <TopBar title={activeConversation.title} />

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
            {activeConversation.messages.length === 0 ? (
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

        {/* Chat Input */}
        <ChatInput
          onSubmit={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
