'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type LogStatus = 'SUCCESS' | 'FAILED' | 'PENDING'

interface LogEntry {
  id: string
  action: string
  status: LogStatus
  createdAt: string
  user: {
    id: string
    name: string
    email: string
  }
  connectedClient?: { id: string; name: string; slug: string } | null
  approvalId?: string | null
  requestId?: string | null
  riskLevel?: string | null
  safeOperationSummary?: string | null
  details?: Record<string, unknown>
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString()
}

export default function LogsPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', status: '', risk: '', from: '', to: '' })

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
    const fetchLogs = async () => {
      try {
        const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
        const response = await fetch(`/api/logs?${query}`, {
          credentials: 'include',
          signal: controller.signal,
        })

        const data = await response.json()

        if (!response.ok || data.success === false) {
          if (response.status === 401) {
            router.push('/login')
            return
          }

          throw new Error(data.message || 'Unable to load audit logs.')
        }

        setLogs(data.logs ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load audit logs.')
      } finally {
        setLoading(false)
      }
    }

    void fetchLogs()
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [router, filters])

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Audit</p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">Logs</h1>
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="cf-button"
          >
            Back to chat
          </button>
        </div>

        <div className="cf-card grid gap-3 p-4 md:grid-cols-5">
          <input aria-label="Search logs" placeholder="Search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} className="cf-input" />
          <select aria-label="Status filter" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="cf-input"><option value="">All statuses</option><option>SUCCESS</option><option>FAILED</option><option>PENDING</option></select>
          <select aria-label="Risk filter" value={filters.risk} onChange={(e) => setFilters({ ...filters, risk: e.target.value })} className="cf-input"><option value="">All risk</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select>
          <input aria-label="From date" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="cf-input" />
          <input aria-label="To date" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="cf-input" />
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
            Loading audit records...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No audit records found for this company yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-left text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 font-medium text-foreground">Timestamp</th>
                    <th className="px-4 py-3 font-medium text-foreground">User</th>
                    <th className="px-4 py-3 font-medium text-foreground">Client</th>
                    <th className="px-4 py-3 font-medium text-foreground">Action</th>
                    <th className="px-4 py-3 font-medium text-foreground">Status</th>
                    <th className="px-4 py-3 font-medium text-foreground">Risk</th>
                    <th className="px-4 py-3 font-medium text-foreground">Approval</th>
                    <th className="px-4 py-3 font-medium text-foreground">Request</th>
                    <th className="px-4 py-3 font-medium text-foreground">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((log) => (
                    <tr key={log.id} className="align-top">
                      <td className="px-4 py-3 text-muted-foreground">{formatTimestamp(log.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{log.user.name}</div>
                        <div className="text-xs text-muted-foreground">{log.user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{log.connectedClient?.name || 'Inventory fallback'}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{log.action}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            log.status === 'SUCCESS'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : log.status === 'FAILED'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-yellow-500/10 text-yellow-400'
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{log.riskLevel || 'N/A'}</td>
                      <td className="px-4 py-3 text-muted-foreground break-all">{log.approvalId || 'N/A'}</td>
                      <td className="px-4 py-3 text-muted-foreground break-all">{log.requestId || 'N/A'}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-md space-y-1 text-muted-foreground">
                          {log.safeOperationSummary ? (
                            <div className="font-medium text-foreground">{log.safeOperationSummary}</div>
                          ) : null}
                          {log.details && Object.keys(log.details).length > 0 ? (
                            <ul className="space-y-1 text-xs">
                              {Object.entries(log.details)
                                .filter(([key]) => !['approvalId', 'requestId', 'riskLevel', 'safeOperationSummary'].includes(key))
                                .slice(0, 6)
                                .map(([key, value]) => (
                                  <li key={key}>
                                    <span className="font-medium text-foreground">{key}:</span>{' '}
                                    {typeof value === 'string' ? value : JSON.stringify(value)}
                                  </li>
                                ))}
                            </ul>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
