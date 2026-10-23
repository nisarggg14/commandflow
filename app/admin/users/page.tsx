'use client'

import { ArrowLeft, CircleAlert, UserRound, UserRoundCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  createdAt: string
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [invitationCode, setInvitationCode] = useState('')
  const [generatingInvitationCode, setGeneratingInvitationCode] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/users', { credentials: 'include' })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 401) router.push('/login')
        else if (response.status === 403) router.push('/')
        else setError(body.message || 'Unable to load users.')
      } else {
        setUsers(body.users || [])
      }
    } catch {
      setError('Unable to load users.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  const update = async (userId: string, changes: Record<string, unknown>) => {
    setError('')
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId, ...changes }),
      })
      const result = await response.json()
      if (!response.ok) setError(result.message || 'Unable to update user.')
      else void load()
    } catch {
      setError('Unable to update user.')
    }
  }

  const rotateInvitationCode = async () => {
    setError('')
    setInvitationCode('')
    setGeneratingInvitationCode(true)
    try {
      const response = await fetch('/api/admin/invitation-code', {
        method: 'POST',
        credentials: 'include',
      })
      const result = await response.json() as { message?: string; invitationCode?: string }
      if (response.status === 401) {
        router.push('/login')
      } else if (response.status === 403) {
        router.push('/')
      } else if (!response.ok || !result.invitationCode) {
        setError(result.message || 'Unable to generate an invitation code.')
      } else {
        setInvitationCode(result.invitationCode)
      }
    } catch {
      setError('Unable to generate an invitation code.')
    } finally {
      setGeneratingInvitationCode(false)
    }
  }

  return (
    <main className="cf-page p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="cf-kicker">Administration / Directory</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Users</h1>
            <p className="mt-2 text-sm text-muted-foreground">Manage access for users in your company.</p>
          </div>
          <button className="cf-button" onClick={() => router.push('/admin')}>
            <ArrowLeft className="h-4 w-4" /> Overview
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <CircleAlert className="h-4 w-4" />{error}
          </div>
        )}

        <section className="cf-card space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Company invitation code</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a code for new members. Rotating it immediately invalidates the previous code.
            </p>
          </div>
          <button
            className="cf-button"
            disabled={generatingInvitationCode}
            onClick={() => void rotateInvitationCode()}
          >
            {generatingInvitationCode ? 'Generating...' : 'Generate or rotate code'}
          </button>
          {invitationCode && (
            <p className="break-all rounded-lg border border-border bg-muted p-3 font-mono text-sm" role="status">
              {invitationCode}
            </p>
          )}
          {invitationCode && (
            <p className="text-xs text-muted-foreground">
              This code is shown once. Share it only with intended company members and rotate it if exposed.
            </p>
          )}
        </section>

        <div className="cf-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="text-sm font-semibold">Company directory</p>
            <span className="text-xs text-muted-foreground">{users.length} users</span>
          </div>
          {loading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : users.length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="divide-y divide-border">
              {users.map((user) => (
                <div key={user.id} className="flex flex-wrap items-center gap-4 p-4 md:px-5">
                  <div className="flex min-w-[14rem] flex-1 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      <p className="text-[10px] text-muted-foreground">Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      aria-label={`Role for ${user.name}`}
                      value={user.role}
                      onChange={(event) => void update(user.id, { role: event.target.value })}
                      className="cf-input min-h-8 py-1.5 text-xs"
                    >
                      <option>ADMIN</option>
                      <option>MANAGER</option>
                      <option>VIEWER</option>
                    </select>
                    <span className={`cf-badge text-[10px] ${user.active ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {user.active ? <UserRoundCheck className="h-3 w-3" /> : null}
                      {user.active ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      className="cf-button min-h-8 px-2.5 py-1.5 text-xs"
                      onClick={() => void update(user.id, { active: !user.active })}
                    >
                      {user.active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
