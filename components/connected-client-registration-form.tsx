'use client'

import { Eye, EyeOff, X } from 'lucide-react'
import { FormEvent, useState } from 'react'

interface SavedClient {
  id: string
  name: string
  slug: string
  status: string
}

interface ConnectedClientRegistrationFormProps {
  onClose: () => void
  onSaved: (client: SavedClient) => void
}

export function ConnectedClientRegistrationForm({ onClose, onSaved }: ConnectedClientRegistrationFormProps) {
  const [name, setName] = useState('Inventory Backend')
  const [baseUrl, setBaseUrl] = useState('http://localhost:5000')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [working, setWorking] = useState(false)
  const [tested, setTested] = useState(false)
  const [productCount, setProductCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'configured' | 'testing' | 'connected' | 'failed'>('configured')

  const testConnection = async () => {
    setWorking(true)
    setTested(false)
    setError('')
    setProductCount(null)
    setStatus('testing')
    try {
      const response = await fetch('/api/connected-clients/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseUrl, username, password }),
      })
      const result = await response.json() as { success?: boolean; message?: string; productCount?: number }
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Connection test failed.')
      }
      setProductCount(result.productCount ?? 0)
      setTested(true)
      setStatus('connected')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Connection test failed.')
      setStatus('failed')
    } finally {
      setWorking(false)
    }
  }

  const saveClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tested) {
      setError('Test the connection successfully before saving.')
      return
    }
    setWorking(true)
    setError('')
    try {
      const response = await fetch('/api/connected-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          baseUrl,
          authType: 'INVENTORY_LOGIN',
          authConfig: { username, password },
        }),
      })
      const result = await response.json() as { success?: boolean; message?: string; connectedClient?: SavedClient }
      if (!response.ok || !result.success || !result.connectedClient) {
        throw new Error(result.message || 'Unable to save connected client.')
      }
      setPassword('')
      setUsername('')
      onSaved(result.connectedClient)
      onClose()
    } catch (caught) {
      setError(`Connection succeeded, but the client was not saved. ${caught instanceof Error ? caught.message : 'Please try again.'}`)
    } finally {
      setWorking(false)
    }
  }

  const invalidateTest = () => {
    setTested(false)
    setProductCount(null)
    setStatus('configured')
    setError('')
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="register-client-title" className="cf-card w-full max-w-lg space-y-5 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="cf-kicker">Company integrations</p>
            <h2 id="register-client-title" className="mt-1 text-lg font-semibold">Add Connected Client</h2>
            <p className="mt-1 text-xs text-muted-foreground">External credentials are encrypted before storage and never returned by the API.</p>
          </div>
          <button type="button" aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(event) => void saveClient(event)} className="space-y-3">
          <label className="block text-xs font-medium">Client name
            <input required minLength={2} maxLength={100} value={name} onChange={(event) => { setName(event.target.value); invalidateTest() }} className="cf-input mt-1 w-full" />
          </label>
          <label className="block text-xs font-medium">API base URL
            <input required type="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); invalidateTest() }} className="cf-input mt-1 w-full" placeholder="https://inventory.example.com" />
          </label>
          <label className="block text-xs font-medium">External website admin username
            <input required autoComplete="off" value={username} onChange={(event) => { setUsername(event.target.value); invalidateTest() }} className="cf-input mt-1 w-full" />
          </label>
          <label className="block text-xs font-medium">External website admin password
            <span className="relative mt-1 block">
              <input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); invalidateTest() }} className="cf-input w-full pr-10" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </span>
          </label>
          <div className="flex items-center gap-2 text-xs" role="status">
            <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-emerald-500' : status === 'failed' ? 'bg-destructive' : status === 'testing' ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground'}`} />
            <span className="capitalize">{status}</span>
            {productCount !== null && <span className="text-muted-foreground">· token-bearing products request returned {productCount} products</span>}
          </div>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <button type="button" className="cf-button" disabled={working} onClick={onClose}>Cancel</button>
            <button type="button" className="cf-button" disabled={working || !baseUrl || !username || !password} onClick={() => void testConnection()}>{working && status === 'testing' ? 'Testing...' : 'Test Connection'}</button>
            <button type="submit" className="cf-button cf-button-primary" disabled={working || !tested}>{working && status !== 'testing' ? 'Saving...' : 'Save Client'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
