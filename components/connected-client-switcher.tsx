'use client'

import { ChevronDown, Radio } from 'lucide-react'

interface ConnectedClientOption { id: string; name: string; slug: string; status: string }
interface ConnectedClientSwitcherProps { clients: ConnectedClientOption[]; selectedClientId?: string; disabled?: boolean; onChange: (clientId?: string) => void }

export function ConnectedClientSwitcher({ clients, selectedClientId, disabled, onChange }: ConnectedClientSwitcherProps) {
  const selected = clients.find((client) => client.id === selectedClientId)
  return <div className="flex min-w-0 items-center gap-3"><div className="hidden items-center gap-2 text-muted-foreground sm:flex"><Radio className="h-3.5 w-3.5" /><span className="cf-label">Target client</span></div><div className="relative"><select aria-label="Connected client" value={selectedClientId ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)} className="cf-input min-w-[13rem] appearance-none pr-9 text-xs font-medium disabled:cursor-not-allowed"><option value="">No client selected — Inventory fallback</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.slug} · configured</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /></div>{selected && <span className="hidden text-[11px] text-muted-foreground lg:inline">Selected for commands</span>}</div>
}
