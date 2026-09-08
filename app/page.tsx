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

interface PendingMfaRequest {
  conversationId: string
  message: string
  toolName?: string
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
  const [pendingMfaRequest, setPendingMfaRequest] = useState<PendingMfaRequest | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaError, setMfaError] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

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

  const handleSendMessage = async (
    message: string,
    options?: { mfaChallengeToken?: string; skipUserMessage?: boolean }
  ) => {
    if (!activeConversationId) return

    if (!options?.skipUserMessage) {
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
    }

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
        mfaChallengeToken: options?.mfaChallengeToken,
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
      const payload = JSON.parse(data.response) as CommandExecutionPayload & { message?: string }
      applyUiControl(payload.data)

      if (
        payload.status === 'FAILED' &&
        typeof payload.message === 'string' &&
        (payload.message.includes('requires step-up MFA verification') ||
          payload.message.includes('requires a valid step-up MFA challenge'))
      ) {
        setPendingMfaRequest({
          conversationId: activeConversationId,
          message,
          toolName: payload.toolName ?? undefined,
        })
        setMfaCode('')
        setMfaError('')
        return
      }
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

  const handleVerifyMfa = async () => {
    if (!pendingMfaRequest) return

    setMfaLoading(true)
    setMfaError('')

    const res = await fetch('/api/auth/mfa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        code: mfaCode,
        purpose: pendingMfaRequest.toolName || 'step-up-mfa',
        riskLevel: 'HIGH',
      }),
    })

    const data = await res.json()

    setMfaLoading(false)

    if (!res.ok || !data.success) {
      setMfaError(data.message || 'Invalid MFA code')
      return
    }

    const challengeToken = data.challenge?.challengeToken
    if (!challengeToken) {
      setMfaError('MFA verification failed.')
      return
    }

    setPendingMfaRequest(null)
    setMfaCode('')
    await handleSendMessage(pendingMfaRequest.message, {
      mfaChallengeToken: challengeToken,
      skipUserMessage: true,
    })
  }

  const handleCancelMfa = () => {
    setPendingMfaRequest(null)
    setMfaCode('')
    setMfaError('')
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

        {pendingMfaRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
              <h2 className="text-xl font-semibold text-foreground">MFA Verification Required</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app to continue this high-risk action.
              </p>

              <div className="mt-4">
                <label htmlFor="mfa-code" className="text-sm font-medium text-foreground">
                  6-digit code
                </label>
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none ring-0 placeholder:text-muted-foreground focus:border-ring"
                  placeholder="123456"
                />
              </div>

              {mfaError ? (
                <p className="mt-3 text-sm text-red-600">{mfaError}</p>
              ) : null}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCancelMfa}
                  className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyMfa}
                  disabled={mfaLoading || mfaCode.length !== 6}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {mfaLoading ? 'Verifying…' : 'Verify'}
                </button>
              </div>
            </div>
          </div>
        )}

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
