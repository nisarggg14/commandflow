import { MessageCircle, MoreHorizontal } from 'lucide-react'

interface ConversationItemProps {
  id: string
  title: string
  isActive: boolean
  onClick: () => void
  onDelete?: () => void
  onRename?: () => void
}

export function ConversationItem({
  id,
  title,
  isActive,
  onClick,
  onDelete,
  onRename,
}: ConversationItemProps) {
  return (
    <div
      className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer ${
        isActive ? 'bg-accent bg-opacity-10 text-accent' : 'text-muted-foreground hover:bg-secondary'
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <MessageCircle className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{title}</span>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}
