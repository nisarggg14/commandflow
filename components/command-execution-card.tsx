import { Check, CircleAlert, CircleDot, Clock3, Database, Loader2, MessageSquare, Network, Wrench } from 'lucide-react'
import type { ExecutionStage, ExecutionStageStatus } from '@/types/execution-trace'
import { EXECUTION_STAGE_DEFINITIONS } from '@/types/execution-trace'

export interface CommandExecutionPayload {
  type: 'execution'
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN'
  toolName?: string | null
  rowsAffected?: number
  executionTimeMs?: number
  errors?: string[]
  data?: unknown
  message?: string
  stages?: ExecutionStage[]
  metrics?: { totalExecutions: number; successfulExecutions: number; failedExecutions: number; averageExecutionTime: number }
}
interface CommandExecutionCardProps { payload: CommandExecutionPayload }

const icons = [MessageSquare, Network, Wrench, Wrench, Database, Check]
const stageStatuses = new Set<ExecutionStageStatus>(['pending', 'running', 'completed', 'failed'])

function isExecutionStage(value: unknown): value is ExecutionStage {
  if (!value || typeof value !== 'object') return false
  const stage = value as Record<string, unknown>
  const definition = EXECUTION_STAGE_DEFINITIONS.find((item) => item.id === stage.id)
  return Boolean(
    definition &&
      stage.label === definition.label &&
      typeof stage.status === 'string' &&
      stageStatuses.has(stage.status as ExecutionStageStatus) &&
      (stage.durationMs === undefined || (typeof stage.durationMs === 'number' && Number.isFinite(stage.durationMs) && stage.durationMs >= 0)) &&
      (stage.error === undefined || typeof stage.error === 'string')
  )
}

function isValidStageList(value: unknown): value is ExecutionStage[] {
  if (!Array.isArray(value) || value.length !== EXECUTION_STAGE_DEFINITIONS.length || !value.every(isExecutionStage)) return false
  return new Set(value.map((stage) => stage.id)).size === EXECUTION_STAGE_DEFINITIONS.length
}

function badge(status: CommandExecutionPayload['status']) { return status === 'SUCCESS' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : status === 'FAILED' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border bg-muted text-muted-foreground' }

function stageStyle(status: ExecutionStageStatus) {
  if (status === 'completed') return 'border-foreground bg-foreground text-background'
  if (status === 'running') return 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
  if (status === 'failed') return 'border-destructive bg-destructive/10 text-destructive'
  return 'border-border bg-background text-muted-foreground'
}

function stageIcon(status: ExecutionStageStatus, Icon: typeof Check) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (status === 'failed') return <CircleAlert className="h-3.5 w-3.5" />
  if (status === 'pending') return <CircleDot className="h-3.5 w-3.5" />
  return <Icon className="h-3.5 w-3.5" />
}

export function CommandExecutionCard({ payload }: CommandExecutionCardProps) {
  const stages: ExecutionStage[] = isValidStageList(payload.stages)
    ? payload.stages
    : EXECUTION_STAGE_DEFINITIONS.map((stage) => ({ ...stage, status: 'pending' as const }))
  const isFailed = payload.status === 'FAILED'
  return <article className="cf-card overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary"><Wrench className="h-3.5 w-3.5" /></span><div><p className="text-sm font-semibold">Command execution</p><p className="text-xs text-muted-foreground">{payload.toolName || 'No tool selected'}</p></div></div></div><span className={`cf-badge ${badge(payload.status)}`}>{isFailed ? <CircleAlert className="h-3 w-3" /> : <Check className="h-3 w-3" />}{payload.status}</span></div><div className="border-b border-border bg-muted/20 px-5 py-5"><p className="cf-label mb-4">Execution path</p><div className="flex items-start justify-between gap-1 overflow-x-auto pb-1">{stages.map((stage, index) => { const Icon = icons[index] ?? Wrench; return <div key={stage.id} className="flex min-w-[7rem] flex-1 items-center"><div className="flex flex-col items-center gap-2"><span className={`flex h-8 w-8 items-center justify-center rounded-full border ${stageStyle(stage.status)}`}>{stageIcon(stage.status, Icon)}</span><span className="text-center text-[10px] font-medium text-muted-foreground">{stage.label}</span><span className="text-[10px] text-muted-foreground">{stage.durationMs !== undefined ? `${stage.durationMs} ms` : stage.status}</span></div>{index < stages.length - 1 && <span className={`mx-1 mt-4 h-px flex-1 ${stage.status === 'completed' ? 'bg-foreground/40' : 'bg-border'}`} />}</div>})}</div></div><div className="grid gap-3 p-5 sm:grid-cols-3"><div className="rounded-xl border border-border bg-background p-3"><p className="cf-label">Status</p><p className="mt-2 text-sm font-semibold">{payload.status}</p></div><div className="rounded-xl border border-border bg-background p-3"><p className="cf-label">Rows affected</p><p className="mt-2 text-sm font-semibold">{payload.rowsAffected ?? 0}</p></div><div className="rounded-xl border border-border bg-background p-3"><p className="cf-label">Duration</p><p className="mt-2 flex items-center gap-1 text-sm font-semibold"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />{payload.executionTimeMs !== undefined ? `${payload.executionTimeMs} ms` : 'Not available'}</p></div></div>{stages.some((stage) => stage.error) ? <div className="mx-5 mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><p className="font-semibold">Execution failed</p><ul className="mt-2 list-disc space-y-1 pl-5">{stages.filter((stage) => stage.error).map((stage) => <li key={stage.id}>{stage.label}: {stage.error}</li>)}</ul></div> : payload.errors?.length ? <div className="mx-5 mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><p className="font-semibold">Execution failed</p><ul className="mt-2 list-disc space-y-1 pl-5">{payload.errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}{payload.message ? <div className="mx-5 mb-5 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Message</p><p className="mt-1">{payload.message}</p></div> : null}{payload.metrics ? <div className="mx-5 mb-5 grid grid-cols-2 gap-2 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-4">{[['Total', payload.metrics.totalExecutions], ['Successful', payload.metrics.successfulExecutions], ['Failed', payload.metrics.failedExecutions], ['Average', `${payload.metrics.averageExecutionTime} ms`]].map(([label, value]) => <div key={String(label)}><p className="cf-label">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div> : null}{payload.data !== undefined && <details className="border-t border-border p-5"><summary className="cursor-pointer text-sm font-medium">View returned data</summary><pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-background p-4 text-xs leading-5 text-muted-foreground">{JSON.stringify(payload.data, null, 2)}</pre></details>}</article>
}
