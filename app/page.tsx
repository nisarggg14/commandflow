'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatSidebar } from '@/components/chat-sidebar'
import { TopBar } from '@/components/top-bar'
import { ChatInput } from '@/components/chat-input'
import { MessageBubble } from '@/components/message-bubble'
import { EmptyState } from '@/components/empty-state'
import { CommandExecutionCard, type CommandExecutionPayload } from '@/components/command-execution-card'
import { ConnectedClientSwitcher } from '@/components/connected-client-switcher'
import { chatSubmissionErrorMessage, createClientId } from '@/lib/chat-client'

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
  connectedClientId?: string | null
}

interface ConnectedClient {
  id: string
  name: string
  slug: string
  status: string
}

interface PendingMfaRequest {
  conversationId: string
  message: string
  toolName?: string
  approvalId?: string
  connectedClientId?: string | null
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
  | { type: 'frontend-control'; action: 'updateBackground'; background: 'obsidian' | 'paper' | 'mist' }
  | { type: 'frontend-control'; action: 'updateTheme'; theme: 'light' | 'dark' | 'system' }
  | { type: 'frontend-control'; action: 'updateNavbar'; density: 'comfortable' | 'compact'; showCompanyName: boolean }
  | { type: 'frontend-control'; action: 'updateBranding'; accent: 'mint' | 'sky' | 'amber'; mark: 'commandflow' | 'inventory' }

function applyUiControl(value: unknown) {
  if (!value || typeof value !== 'object' || !('type' in value) || (value.type !== 'ui-control' && value.type !== 'frontend-control')) return

  const control = value as UiControl
  const root = document.documentElement

  if (control.type === 'frontend-control' && control.action === 'updateTheme') {
    root.classList.toggle('dark', control.theme === 'dark')
    root.classList.toggle('light', control.theme === 'light')
    if (control.theme === 'system') root.classList.remove('dark', 'light')
  }

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

  if (control.type === 'frontend-control' && control.action === 'updateBackground') {
    const backgrounds = { obsidian: '#0a0a0a', paper: '#f7f5ef', mist: '#e8f0f2' } as const
    root.style.setProperty('--background', backgrounds[control.background])
  }

  if (control.type === 'frontend-control' && control.action === 'updateNavbar') {
    root.dataset.navbarDensity = control.density
    root.dataset.showCompanyName = String(control.showCompanyName)
  }

  if (control.type === 'frontend-control' && control.action === 'updateBranding') {
    const accents = { mint: '#10a37f', sky: '#0284c7', amber: '#d97706' } as const
    root.style.setProperty('--accent', accents[control.accent])
    root.style.setProperty('--ring', accents[control.accent])
    root.style.setProperty('--primary', accents[control.accent])
    root.dataset.brandMark = control.mark
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
  const [continuingApprovalId, setContinuingApprovalId] = useState<string | null>(null)
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([])
  const [connectedClientsError, setConnectedClientsError] = useState('')
  const [activeConnectedClientId, setActiveConnectedClientId] = useState<string | undefined>()
  const [commandError, setCommandError] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const bootstrapStartedRef = useRef(false)

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
    if (bootstrapStartedRef.current) return
    bootstrapStartedRef.current = true

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

      const clientsRequest = fetch('/api/connected-clients?status=ACTIVE', {
        credentials: 'include',
      }).catch(() => null)
      const [clientsRes, conversationsRes] = await Promise.all([
        clientsRequest,
        fetch('/api/conversations', { credentials: 'include' }).catch(() => null),
      ])
      let restoredConversationClientId: string | undefined
      if (conversationsRes?.ok) {
        const conversationsData = await conversationsRes.json()
        const restored = Array.isArray(conversationsData.conversations)
          ? conversationsData.conversations as Conversation[]
          : []
        if (restored.length > 0) {
          setConversations(restored)
          setActiveConversationId(restored[0].id)
          restoredConversationClientId = restored[0].connectedClientId ?? undefined
          setActiveConnectedClientId(restoredConversationClientId)
        } else {
          await handleNewChat()
        }
      } else {
        await handleNewChat()
      }
      if (!clientsRes?.ok) {
        setConnectedClientsError('Connected clients are temporarily unavailable.')
        return
      }
      const clientsData = await clientsRes.json()
      const clients = Array.isArray(clientsData.connectedClients)
        ? clientsData.connectedClients as ConnectedClient[]
        : []
      setConnectedClients(clients)
      setConnectedClientsError('')
      const savedSelection = window.localStorage.getItem(`commandflow:selected-client:${data.user.company?.id ?? ''}`)
      if (!restoredConversationClientId && savedSelection && clients.some((client) => client.id === savedSelection)) {
        setActiveConnectedClientId(savedSelection)
      }
    }

    void loadUser()
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
      connectedClientId: data.connectedClientId ?? null,
    }

    setConversations((prev) => [...prev, conversation])
    setActiveConversationId(conversation.id)
  }

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id)
    const conversation = conversations.find((item) => item.id === id)
    const selectedId = conversation?.connectedClientId ?? undefined
    setActiveConnectedClientId(selectedId && connectedClients.some((client) => client.id === selectedId) ? selectedId : undefined)
    setSidebarOpen(false)
  }

  const handleConnectedClientChange = (clientId?: string) => {
    setActiveConnectedClientId(clientId)
    if (authUser?.company?.id) {
      const key = `commandflow:selected-client:${authUser.company.id}`
      if (clientId) window.localStorage.setItem(key, clientId)
      else window.localStorage.removeItem(key)
    }
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === activeConversationId
        ? { ...conversation, connectedClientId: clientId ?? null }
        : conversation
    )))
  }

  const handleSendMessage = async (
    message: string,
    options?: { mfaChallengeToken?: string; skipUserMessage?: boolean; approvalId?: string; connectedClientId?: string | null }
  ) => {
    if (!activeConversationId) return

    setCommandError('')
    setIsLoading(true)
    try {
      if (!options?.skipUserMessage) {
        const userMessage: Message = {
          id: createClientId(),
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
          connectedClientId: options?.connectedClientId === undefined ? activeConnectedClientId ?? null : options.connectedClientId,
          approvalId: options?.approvalId,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        if (data.message === 'Selected connected client is unavailable.') {
          setActiveConnectedClientId(undefined)
          setConnectedClients((prev) => prev.filter((client) => client.id !== activeConnectedClientId))
        }
        if (typeof data.response === 'string') {
          setActiveConnectedClientId(data.connectedClientId ?? undefined)
          setConversations((prev) => prev.map((conversation) => (
            conversation.id === activeConversationId
              ? { ...conversation, connectedClientId: data.connectedClientId ?? null }
              : conversation
          )))

          try {
            const payload = JSON.parse(data.response) as CommandExecutionPayload & { message?: string }
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
            // Render malformed execution responses as normal assistant content.
          }

          const executionMessage: Message = {
            id: createClientId(),
            role: 'assistant',
            content: data.response,
          }
          setConversations((prev) => prev.map((conversation) => (
            conversation.id === activeConversationId
              ? { ...conversation, messages: [...conversation.messages, executionMessage] }
              : conversation
          )))
          return
        }

        const failureMessage = data.message || 'The command could not be completed.'
        const requestId = typeof data.requestId === 'string'
          ? data.requestId
          : res.headers.get('X-Request-ID')
        const failureContent = Array.isArray(data.execution?.stages)
          ? JSON.stringify({
              type: 'execution',
              status: 'FAILED',
              toolName: null,
              executionTimeMs: Number(res.headers.get('X-Request-Duration-Ms')) || undefined,
              errors: [failureMessage],
              message: requestId ? `${failureMessage} Request ID: ${requestId}` : failureMessage,
              stages: data.execution.stages,
            })
          : requestId && res.status >= 500
            ? `${failureMessage} (Request ID: ${requestId})`
            : failureMessage
        const errorMessage: Message = {
          id: createClientId(),
          role: 'assistant',
          content: failureContent,
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

      setActiveConnectedClientId(data.connectedClientId ?? undefined)
      setConversations((prev) => prev.map((conversation) => (
        conversation.id === activeConversationId
          ? { ...conversation, connectedClientId: data.connectedClientId ?? null }
          : conversation
      )))

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
        id: createClientId(),
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
    } catch (error) {
      setCommandError(chatSubmissionErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleContinueApproved = async (
    payload: CommandExecutionPayload,
    message: string,
    connectedClientId: string | null | undefined,
  ) => {
    if (!payload.approvalId) return
    setContinuingApprovalId(payload.approvalId)
    setCommandError('')
    try {
      const response = await fetch(`/api/approvals/${encodeURIComponent(payload.approvalId)}`, { credentials: 'include' })
      const body = await response.json()
      if (response.status === 401) {
        router.push('/login')
        return
      }
      if (!response.ok) {
        setCommandError(body.message || 'Unable to check the approval status.')
        return
      }
      const status = body.approval?.status
      if (status !== 'APPROVED') {
        setCommandError(status === 'PENDING'
          ? 'Administrator approval is still pending.'
          : `This request is ${String(status || 'unavailable').toLowerCase()} and cannot be continued.`)
        return
      }
      setPendingMfaRequest({
        conversationId: activeConversationId,
        message: typeof body.approval?.originalCommand === 'string' && body.approval.originalCommand.trim()
          ? body.approval.originalCommand
          : message,
        toolName: payload.toolName ?? undefined,
        approvalId: payload.approvalId,
        connectedClientId,
      })
      setMfaCode('')
      setMfaError('')
    } catch {
      setCommandError('Unable to check the approval status.')
    } finally {
      setContinuingApprovalId(null)
    }
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
    if (pendingMfaRequest.approvalId) {
      try {
        const continuationResponse = await fetch(`/api/approvals/${encodeURIComponent(pendingMfaRequest.approvalId)}/continue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ challengeToken }),
        })
        const continuationData = await continuationResponse.json()
        if (!continuationResponse.ok || !continuationData.response) {
          setCommandError(continuationData.message || 'Approved operation could not be continued.')
          return
        }
        const assistantMessage: Message = {
          id: createClientId(),
          role: 'assistant',
          content: JSON.stringify(continuationData.response),
        }
        setConversations((prev) => prev.map((conversation) => (
          conversation.id === pendingMfaRequest.conversationId
            ? { ...conversation, messages: [...conversation.messages, assistantMessage] }
            : conversation
        )))
      } catch {
        setCommandError('Approved operation could not be continued.')
      }
      return
    }
    await handleSendMessage(pendingMfaRequest.message, {
      mfaChallengeToken: challengeToken,
      skipUserMessage: true,
      connectedClientId: pendingMfaRequest.connectedClientId,
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
        clients={connectedClients}
        clientsError={connectedClientsError}
        selectedClientId={activeConnectedClientId}
        userRole={authUser?.role}
        onClientRegistered={(client) => {
          setConnectedClients((previous) => [client, ...previous.filter((item) => item.id !== client.id)])
          handleConnectedClientChange(client.id)
        }}
        onClientChange={handleConnectedClientChange}
      />

      <div className="flex flex-col flex-1 w-full md:w-0">
        <TopBar title={activeConversation?.title || 'CommandFlow'} user={authUser} />

        <div className="flex items-center justify-between border-b border-border bg-background px-4 py-2.5 md:px-7">
          <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Secure command channel</div>
          <ConnectedClientSwitcher
            clients={connectedClients}
            selectedClientId={activeConnectedClientId}
            disabled={isLoading}
            onChange={handleConnectedClientChange}
          />
        </div>

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
          <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
            {!activeConversation ||
            activeConversation.messages.length === 0 ? (
              <EmptyState onSuggestionClick={handleSuggestionClick} role={authUser?.role} />
            ) : (
              <div className="space-y-6">
                {activeConversation.messages.map((msg, index) => {
                  if (msg.role === 'assistant') {
                    const payload = parseExecutionPayload(msg.content)

                    if (payload) {
                      return (
                        <div key={msg.id} className="flex justify-start">
                          <div className="w-full max-w-3xl">
                            <CommandExecutionCard
                              payload={payload}
                              continuing={payload.approvalId === continuingApprovalId}
                              onContinueApproved={payload.status === 'PENDING_APPROVAL' && payload.approvalId && activeConversation.messages[index - 1]?.role === 'user'
                                ? () => void handleContinueApproved(payload, activeConversation.messages[index - 1].content, payload.connectedClientId)
                                : undefined}
                            />
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

        {commandError ? (
          <p role="alert" className="px-4 pb-2 text-center text-sm text-destructive">
            {commandError}
          </p>
        ) : null}
        <ChatInput
          onSubmit={handleSendMessage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
