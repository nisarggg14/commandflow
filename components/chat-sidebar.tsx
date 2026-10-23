'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Activity, ChevronRight, FileText, LayoutDashboard, LogOut, Menu, Plus, Settings, ShieldAlert, Users } from 'lucide-react'
import { ConversationItem } from './conversation-item'
import { ConnectedClientRegistrationForm } from './connected-client-registration-form'

interface ChatSidebarProps {
  isOpen: boolean
  onToggle: () => void
  conversations: Array<{ id: string; title: string }>
  activeConversationId?: string
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  clients?: Array<{ id: string; name: string; slug: string; status: string }>
  clientsError?: string
  selectedClientId?: string
  userRole?: string
  onClientRegistered?: (client: { id: string; name: string; slug: string; status: string }) => void
  onClientChange?: (clientId?: string) => void
}

export function ChatSidebar({ isOpen, onToggle, conversations, activeConversationId, onSelectConversation, onNewChat, clients = [], clientsError, selectedClientId, userRole, onClientRegistered, onClientChange }: ChatSidebarProps) {
  const router = useRouter()
  const [registeringClient, setRegisteringClient] = useState(false)
  const navigate = (path: string) => { router.push(path); onToggle() }

  return <>
    <button onClick={onToggle} aria-label="Open navigation" className="cf-button cf-button-primary fixed bottom-5 left-4 z-40 p-2 md:hidden"><Menu className="h-5 w-5" /></button>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col border-r border-border bg-sidebar transition-transform md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="border-b border-sidebar-border p-5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-foreground text-xs font-bold text-sidebar">CF</div><div><p className="text-sm font-semibold tracking-tight">CommandFlow</p><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Command center</p></div></div><button onClick={onNewChat} className="cf-button cf-button-primary mt-5 w-full justify-between"><span className="flex items-center gap-2"><Plus className="h-4 w-4" /> New command</span><span className="text-xs opacity-60">⌘ K</span></button></div>
      <div className="px-3 pt-4"><p className="cf-kicker px-2 pb-2">Workspace</p><nav className="space-y-1" aria-label="Workspace navigation"><button className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-medium"><Activity className="h-4 w-4" /> Command center</button><button onClick={() => navigate('/logs')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"><FileText className="h-4 w-4" /> Activity logs</button></nav></div>
      <div className="mt-4 border-b border-t border-sidebar-border px-3 py-4"><div className="flex items-center justify-between px-2 pb-2"><p className="cf-kicker">Registered clients</p><span className="text-[10px] text-muted-foreground">{clientsError ? 'Unavailable' : `${clients.length} enabled`}</span></div>{clientsError ? <p role="alert" className="px-2 text-xs leading-5 text-destructive">{clientsError}</p> : clients.length ? <div className="space-y-1">{clients.map((client) => <button key={client.id} type="button" onClick={() => onClientChange?.(client.id)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent ${selectedClientId === client.id ? 'bg-sidebar-accent' : ''}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-[9px] font-bold">{(client.name || client.slug).slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{client.name || client.slug}</span><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> configured · {client.status.toLowerCase()}</span></span>{selectedClientId === client.id && <ChevronRight className="h-3 w-3 text-muted-foreground" />}</button>)}</div> : <p className="px-2 text-xs leading-5 text-muted-foreground">No clients are registered for this company.</p>}{userRole === 'ADMIN' && <button type="button" onClick={() => setRegisteringClient(true)} className="cf-button mt-3 min-h-8 w-full justify-center px-2 py-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add Client</button>}</div>
      <div className="flex-1 overflow-y-auto px-3 py-4"><div className="flex items-center justify-between px-2 pb-2"><p className="cf-kicker">Conversations</p>{conversations.length > 0 && <span className="text-[10px] text-muted-foreground">{conversations.length}</span>}</div>{conversations.slice(0, 3).map((conversation) => <ConversationItem key={conversation.id} id={conversation.id} title={conversation.title} isActive={activeConversationId === conversation.id} onClick={() => onSelectConversation(conversation.id)} />)}{conversations.length === 0 && <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">Your commands and results will appear here.</p>}{conversations.length > 3 && <><p className="cf-kicker px-2 pb-2 pt-6">Previous</p>{conversations.slice(3).map((conversation) => <ConversationItem key={conversation.id} id={conversation.id} title={conversation.title} isActive={activeConversationId === conversation.id} onClick={() => onSelectConversation(conversation.id)} />)}</>}</div>
      <div className="border-t border-sidebar-border p-3"><p className="cf-kicker px-2 pb-2">Manage</p>{(userRole === 'ADMIN' ? [{ label: 'Admin overview', icon: LayoutDashboard, path: '/admin' }, { label: 'Approvals', icon: ShieldAlert, path: '/admin/approvals' }, { label: 'Users', icon: Users, path: '/admin/users' }, { label: 'Security settings', icon: Settings, path: '/settings/security' }] : [{ label: 'Security settings', icon: Settings, path: '/settings/security' }]).map(({ label, icon: Icon, path }) => <button key={label} onClick={() => navigate(path)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"><Icon className="h-4 w-4" />{label}</button>)}<button onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login') }} className="mt-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-destructive"><LogOut className="h-4 w-4" /> Sign out</button></div>
    </aside>{isOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onToggle} />}{registeringClient && <ConnectedClientRegistrationForm onClose={() => setRegisteringClient(false)} onSaved={(client) => onClientRegistered?.(client)} />}
  </>
}
