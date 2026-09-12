'use client'

interface ConnectedClientOption {
  id: string
  name: string
  slug: string
  status: string
}

interface ConnectedClientSwitcherProps {
  clients: ConnectedClientOption[]
  selectedClientId?: string
  disabled?: boolean
  onChange: (clientId?: string) => void
}

export function ConnectedClientSwitcher({
  clients,
  selectedClientId,
  disabled,
  onChange,
}: ConnectedClientSwitcherProps) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="hidden sm:inline">Client</span>
      <select
        aria-label="Connected client"
        value={selectedClientId ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="max-w-[13rem] rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">Inventory fallback</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name || client.slug}
          </option>
        ))}
      </select>
    </label>
  )
}
