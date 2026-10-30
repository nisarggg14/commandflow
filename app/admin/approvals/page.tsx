'use client'

import { ArrowLeft, Check, CircleAlert, Clock3, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface Approval {
  id: string
  toolName: string
  riskLevel: string
  safeArgumentsSummary: string
  status: string
  createdAt: string
  expiresAt: string
  requester?: { name: string; email: string; role: string }
  connectedClient?: { id: string; name: string; slug: string | null } | null
}

function isSessionAuthenticationFailure(status: number, message: unknown): boolean {
  if (status !== 401) return false
  const text = typeof message === 'string' ? message : ''
  return /authentication required|invalid authentication token|session (?:is no longer valid|expired)|user account or company association/i.test(text)
}

export default function AdminApprovalsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [processing, setProcessing] = useState<string | null>(null)
  const [adminSelfApprovalEnabled, setAdminSelfApprovalEnabled] = useState(false)
  const selectedApprovalId = searchParams.get('id')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/approvals', { credentials: 'include' })
      const body = await response.json()
      if (isSessionAuthenticationFailure(response.status, body.message)) router.push('/login')
      else if (response.status === 403) router.push('/')
      else if (!response.ok) setError(body.message || 'Unable to load approvals.')
      else {
        setApprovals(body.approvals || [])
        setAdminSelfApprovalEnabled(body.adminSelfApprovalEnabled === true)
      }
    } catch {
      setError('Unable to load approvals.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [router])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedApprovalId || !approvals.some((approval) => approval.id === selectedApprovalId)) return
    document.getElementById(`approval-request-${selectedApprovalId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [approvals, selectedApprovalId])

  const processApproval = async (approval: Approval, action: 'approve' | 'reject') => {
    setError('')
    setNotice('')
    if (action === 'approve' && !/^\d{6}$/.test(codes[approval.id] || '')) {
      setError('Enter the current six-digit MFA code to approve this request.')
      return
    }
    setProcessing(approval.id)
    try {
      const response = await fetch(`/api/approvals/${approval.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(action === 'approve'
          ? { code: codes[approval.id] }
          : { reason: reasons[approval.id] || undefined }),
      })
      const body = await response.json()
      if (isSessionAuthenticationFailure(response.status, body.message)) router.push('/login')
      else if (response.status === 403) router.push('/')
      else if (!response.ok) setError(body.message || `Unable to ${action} approval.`)
      else {
        setNotice(action === 'approve'
          ? 'Approval recorded. The requester can continue the original operation from its conversation after completing requester MFA.'
          : 'Approval rejected. The requested operation was not executed.')
        await load(true)
      }
    } catch {
      setError(`Unable to ${action} approval.`)
    } finally {
      setProcessing(null)
    }
  }

  return (
    <main className="cf-page p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="cf-kicker">Administration / Risk controls</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Approvals</h1>
            <p className="mt-2 text-sm text-muted-foreground">Review company-scoped high-risk operations before they can execute.</p>
          </div>
          <div className="flex gap-2">
            <button className="cf-button" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button className="cf-button" onClick={() => router.push('/admin')}><ArrowLeft className="h-4 w-4" /> Overview</button>
          </div>
        </div>

        {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><CircleAlert className="h-4 w-4" />{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400" role="status">{notice}</div>}
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {adminSelfApprovalEnabled
            ? 'Admin self-approval is enabled by server policy. MFA, expiry, authorization, and execution checks still apply.'
            : 'Admin self-approval is disabled by server policy. A different administrator must approve each destructive request.'}
        </div>

        <section className="cf-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div><p className="text-sm font-semibold">Pending requests</p><p className="mt-1 text-xs text-muted-foreground">Expired requests disappear from this queue and cannot be approved.</p></div>
            <span className="cf-badge">{approvals.length} pending</span>
          </div>
          {loading ? <div className="space-y-3 p-5">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div>
            : approvals.length === 0 ? <div className="p-10 text-center"><Clock3 className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">No pending approvals.</p></div>
            : <div className="divide-y divide-border">{approvals.map((approval) => <article id={`approval-request-${approval.id}`} key={approval.id} className={`space-y-4 p-5 transition-colors ${selectedApprovalId === approval.id ? 'bg-destructive/10 ring-2 ring-inset ring-destructive/40' : ''}`} aria-current={selectedApprovalId === approval.id ? 'true' : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><ShieldAlert className="h-4 w-4" /></div><div className="min-w-0"><p className="text-sm font-semibold">{approval.safeArgumentsSummary}</p><p className="mt-1 break-all text-xs text-muted-foreground">{approval.toolName} · requested by {approval.requester?.name || approval.requester?.email || 'Unknown user'}</p></div></div>
                <span className="cf-badge text-[10px]">{approval.status}</span>
              </div>
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3"><div><span className="cf-label">Client</span><p className="mt-1 text-foreground">{approval.connectedClient?.name || 'Unavailable client'}</p></div><div><span className="cf-label">Created</span><p className="mt-1 text-foreground">{new Date(approval.createdAt).toLocaleString()}</p></div><div><span className="cf-label">Expires</span><p className="mt-1 text-foreground">{new Date(approval.expiresAt).toLocaleString()}</p></div></div>
              <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-end"><label className="flex-1"><span className="cf-label">Approver MFA code</span><input className="cf-input mt-1 w-full" inputMode="numeric" maxLength={6} placeholder="Required to approve" value={codes[approval.id] || ''} onChange={(event) => setCodes((current) => ({ ...current, [approval.id]: event.target.value.replace(/\D/g, '') }))} /></label><label className="flex-1"><span className="cf-label">Rejection reason (optional)</span><input className="cf-input mt-1 w-full" maxLength={500} placeholder="Why is this rejected?" value={reasons[approval.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [approval.id]: event.target.value }))} /></label><div className="flex gap-2"><button className="cf-button cf-button-primary" disabled={processing === approval.id} onClick={() => void processApproval(approval, 'approve')}><Check className="h-4 w-4" />{processing === approval.id ? 'Processing...' : 'Approve'}</button><button className="cf-button" disabled={processing === approval.id} onClick={() => void processApproval(approval, 'reject')}><X className="h-4 w-4" />Reject</button></div></div>
            </article>)}</div>}
        </section>
      </div>
    </main>
  )
}
