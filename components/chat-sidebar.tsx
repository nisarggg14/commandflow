'use client'

import { useState } from 'react'
import { Menu, Plus, Settings, LogOut, User } from 'lucide-react'
import { ConversationItem } from './conversation-item'

interface ChatSidebarProps {
  isOpen: boolean
  onToggle: () => void
  conversations: Array<{ id: string; title: string }>
  activeConversationId?: string
  onSelectConversation: (id: string) => void
  onNewChat: () => void
}

export function ChatSidebar({
  isOpen,
  onToggle,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ChatSidebarProps) {
  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={onToggle}
        className="fixed bottom-24 left-4 z-40 rounded-lg bg-accent p-2 text-accent-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-border flex flex-col transition-transform md:relative md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo & New Chat */}
        <div className="border-b border-border p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-accent flex items-center justify-center">
              <span className="text-accent-foreground text-sm font-bold">CF</span>
            </div>
            <span className="font-semibold text-sidebar-foreground">CommandFlow</span>
          </div>
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground px-1 mb-3">Today</p>
          {conversations.slice(0, 3).map((conv) => (
            <ConversationItem
              key={conv.id}
              id={conv.id}
              title={conv.title}
              isActive={activeConversationId === conv.id}
              onClick={() => onSelectConversation(conv.id)}
            />
          ))}

          {conversations.length > 3 && (
            <>
              <p className="text-xs font-semibold text-muted-foreground px-1 mt-6 mb-3">
                Previous
              </p>
              {conversations.slice(3).map((conv) => (
                <ConversationItem
                  key={conv.id}
                  id={conv.id}
                  title={conv.title}
                  isActive={activeConversationId === conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 space-y-2">
          <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-secondary transition-colors">
            <Settings className="h-4 w-4" />
            Settings
          </button>
          <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-secondary transition-colors">
            <User className="h-4 w-4" />
            Profile
          </button>
          <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground hover:bg-secondary transition-colors text-destructive">
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onToggle}
        />
      )}
    </>
  )
}
