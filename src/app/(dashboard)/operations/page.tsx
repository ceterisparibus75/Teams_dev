'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui'
import { jsonFetcher } from '@/lib/swr'
import { formatDateTime } from '@/lib/utils'

type OperationState = 'ready' | 'processing' | 'failed' | 'blocked' | 'pending'

interface OperationRow {
  id: string
  subject: string
  startDateTime: string
  endDateTime: string
  platform: string
  botStatus: string | null
  participantsCount: number
  minutesId: string | null
  minutesStatus: string | null
  updatedAt: string
  state: OperationState
  transcription: { state: 'found' | 'missing' | 'pending'; label: string }
  generation: {
    state: 'not_started' | 'in_progress' | 'done' | 'failed' | 'draft_without_transcript'
    label: string
  }
  retryRemaining: number
  message: string
}

interface OperationsPayload {
  summary: {
    detected: number
    transcriptionFound: number
    transcriptionMissing: number
    generationRunning: number
    generationFailed: number
    ready: number
  }
  rows: OperationRow[]
}

const stateConfig: Record<OperationState, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'info' }> = {
  ready: { label: 'Prêt', variant: 'success' },
  processing: { label: 'En cours', variant: 'info' },
  failed: { label: 'Échec', variant: 'destructive' },
  blocked: { label: 'Bloqué', variant: 'warning' },
  pending: { label: 'À traiter', variant: 'default' },
}

function metricTone(key: keyof OperationsPayload['summary']): string {
  switch (key) {
    case 'generationFailed':
    case 'transcriptionMissing':
      return 'border-amber-200 bg-amber-50 text-amber-950'
    case 'generationRunning':
      return 'border-blue-200 bg-blue-50 text-blue-950'
    case 'ready':
      return 'border-green-200 bg-green-50 text-green-950'
    default:
      return 'border-gray-200 bg-white text-gray-950'
  }
}

function StateIcon({ state }: { state: OperationState }) {
  if (state === 'ready') return <CheckCircle2 size={16} className="text-green-600" />
  if (state === 'processing') return <Loader2 size={16} className="animate-spin text-blue-600" />
  if (state === 'failed' || state === 'blocked') return <AlertTriangle size={16} className="text-amber-600" />
  return <Clock3 size={16} className="text-gray-400" />
}

export default function OperationsPage() {
  const { data: payload, error: fetchError, isValidating, mutate } = useSWR<OperationsPayload>(
    '/api/operations',
    jsonFetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true },
  )

  const loading = !payload && !fetchError
  const refreshing = isValidating
  const error = fetchError ? (fetchError instanceof Error ? fetchError.message : 'Impossible de charger le suivi des traitements.') : null
  const reload = () => mutate()

  const metrics: Array<{ key: keyof OperationsPayload['summary']; label: string }> = [
    { key: 'detected', label: 'Réunions détectées' },
    { key: 'transcriptionFound', label: 'Transcriptions trouvées' },
    { key: 'transcriptionMissing', label: 'Transcriptions absentes' },
    { key: 'generationRunning', label: 'Générations en cours' },
    { key: 'generationFailed', label: 'Générations échouées' },
    { key: 'ready', label: 'PV prêts' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Fiabilité opérationnelle</p>
          <h1 className="text-2xl font-bold text-gray-900">Suivi des traitements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vue consolidée des réunions, transcriptions, générations Claude, échecs et relances à prévoir.
          </p>
        </div>
        <button
          onClick={reload}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Actualiser
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !payload ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[...Array(6)].map((_, index) => (
              <div key={index} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
          <div className="h-80 rounded-xl bg-gray-100 animate-pulse" />
        </div>
      ) : payload ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {metrics.map((metric) => (
              <div key={metric.key} className={`rounded-xl border p-4 ${metricTone(metric.key)}`}>
                <p className="text-xs font-medium opacity-70">{metric.label}</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">{payload.summary[metric.key]}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">File de traitement</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Rafraîchissement automatique toutes les 20 secondes.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Réunion</th>
                    <th className="px-4 py-3">État</th>
                    <th className="px-4 py-3">Transcription</th>
                    <th className="px-4 py-3">Génération</th>
                    <th className="px-4 py-3">Retry</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payload.rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                        Aucune réunion détectée pour le moment.
                      </td>
                    </tr>
                  )}
                  {payload.rows.map((row) => {
                    const state = stateConfig[row.state]
                    return (
                      <tr key={row.id} className="align-top hover:bg-gray-50/70">
                        <td className="px-4 py-3 min-w-72">
                          <div className="flex items-start gap-2">
                            <StateIcon state={row.state} />
                            <div>
                              <p className="font-medium text-gray-900">{row.subject}</p>
                              <p className="text-xs text-gray-500 mt-1">{formatDateTime(row.startDateTime)}</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {row.participantsCount} participant{row.participantsCount > 1 ? 's' : ''} · {row.platform}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={state.variant}>{state.label}</Badge>
                          {row.botStatus && (
                            <p className="text-xs text-gray-500 mt-2">Bot : {row.botStatus}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={row.transcription.state === 'found' ? 'success' : row.transcription.state === 'missing' ? 'warning' : 'default'}>
                            {row.transcription.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={row.generation.state === 'done' ? 'success' : row.generation.state === 'failed' ? 'destructive' : row.generation.state === 'in_progress' ? 'info' : 'default'}>
                            {row.generation.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="inline-flex items-center gap-1.5 text-gray-700">
                            <RotateCcw size={13} />
                            <span className="font-mono tabular-nums">{row.retryRemaining}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 min-w-80 max-w-xl">
                          <p className="line-clamp-3 text-gray-700">{row.message}</p>
                          <p className="text-xs text-gray-400 mt-1">Dernière mise à jour : {formatDateTime(row.updatedAt)}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {row.minutesId ? (
                            <Link
                              href={`/comptes-rendus/${row.minutesId}`}
                              className="text-sm font-medium text-blue-600 hover:text-blue-800"
                            >
                              Ouvrir le PV
                            </Link>
                          ) : (
                            <Link
                              href="/reunions"
                              className="text-sm font-medium text-blue-600 hover:text-blue-800"
                            >
                              Traiter
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
