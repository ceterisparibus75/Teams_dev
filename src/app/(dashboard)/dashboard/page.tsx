'use client'
import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileText, FolderOpen, Loader2, Video } from 'lucide-react'
import { MeetingCard } from '@/components/meetings/MeetingCard'
import type { AttendanceWarning } from '@/lib/attendance-warning'
import type { MeetingPlatform, BotStatus } from '@prisma/client'

interface MeetingData {
  id: string
  subject: string
  startDateTime: string
  endDateTime: string
  hasTranscription: boolean
  platform: MeetingPlatform
  botStatus: BotStatus | null
  participants: Array<{ name: string; email: string }>
  minutes?: { id: string; status: string; generating: boolean } | null
}

interface GenerateResponse {
  id: string
  generating?: boolean
  attendanceWarning?: AttendanceWarning | null
}

interface OperationsSummary {
  detected: number
  transcriptionFound: number
  transcriptionMissing: number
  generationRunning: number
  generationFailed: number
  ready: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<MeetingData[]>([])
  const [operationsSummary, setOperationsSummary] = useState<OperationsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevGeneratingIds = useRef<Set<string>>(new Set())

  async function loadMeetings() {
    try {
      const r = await fetch('/api/meetings')
      const data = await r.json()
      if (Array.isArray(data)) setMeetings(data)
      return Array.isArray(data) ? (data as MeetingData[]) : []
    } catch {
      return []
    }
  }

  async function loadOperationsSummary() {
    try {
      const r = await fetch('/api/operations', { cache: 'no-store' })
      const data = await r.json()
      if (r.ok && data?.summary) setOperationsSummary(data.summary as OperationsSummary)
    } catch {
      // La page reste utilisable avec les données réunions seules.
    }
  }

  useEffect(() => {
    // Meetings : affichage immédiat dès que la réponse arrive
    loadMeetings().finally(() => setLoading(false))
    // Operations : se charge en fond, met à jour le résumé quand disponible
    loadOperationsSummary()
  }, [])

  // Polling toutes les 15 s si au moins un CR est en cours de génération
  useEffect(() => {
    const generatingMeetings = meetings.filter((m) => m.minutes?.generating)
    if (generatingMeetings.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      prevGeneratingIds.current = new Set()
      return
    }

    prevGeneratingIds.current = new Set(generatingMeetings.map((m) => m.id))

    if (pollingRef.current) return // déjà en cours

    pollingRef.current = setInterval(async () => {
      const updated = await loadMeetings()
      const stillGenerating = updated.filter((m) => m.minutes?.generating)

      // Notifier les réunions dont la génération vient de se terminer
      for (const id of prevGeneratingIds.current) {
        const m = updated.find((u) => u.id === id)
        if (m && m.minutes && !m.minutes.generating) {
          toast.success(`Compte rendu prêt — ${m.subject}`, {
            action: { label: 'Ouvrir', onClick: () => router.push(`/comptes-rendus/${m.minutes!.id}`) },
          })
        }
      }
      prevGeneratingIds.current = new Set(stillGenerating.map((m) => m.id))
    }, 15_000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [meetings, router])

  const generatingMeetings = meetings.filter((m) => m.minutes?.generating)
  const drafts = meetings.filter((m) => m.minutes?.status === 'DRAFT' && !m.minutes?.generating)
  const withoutMinutes = meetings.filter((m) => !m.minutes)
  const problemCount =
    (operationsSummary?.generationFailed ?? 0) + (operationsSummary?.transcriptionMissing ?? 0)
  const readyCount = operationsSummary?.ready ?? meetings.filter((m) => m.minutes && !m.minutes.generating).length
  const workflowCards = [
    {
      title: 'Réunions à traiter',
      value: withoutMinutes.length,
      href: '/reunions',
      description: 'Réunions Teams détectées sans PV.',
      icon: Video,
      tone: 'bg-blue-50 border-blue-200 text-blue-950',
    },
    {
      title: 'PV à relire',
      value: drafts.length,
      href: '/comptes-rendus',
      description: 'Brouillons générés à corriger ou valider.',
      icon: FileText,
      tone: 'bg-amber-50 border-amber-200 text-amber-950',
    },
    {
      title: 'Problèmes',
      value: problemCount,
      href: '/operations',
      description: 'Transcriptions absentes ou générations échouées.',
      icon: AlertTriangle,
      tone: 'bg-red-50 border-red-200 text-red-950',
    },
    {
      title: 'PV prêts',
      value: readyCount,
      href: '/dossiers',
      description: 'PV disponibles à classer, envoyer ou retrouver.',
      icon: FolderOpen,
      tone: 'bg-green-50 border-green-200 text-green-950',
    },
  ]

  async function handleGenerate(meetingId: string) {
    setGenerating(meetingId)
    try {
      const res = await fetch(`/api/generate/${meetingId}`, { method: 'POST' })
      if (!res.ok) { toast.error('Erreur lors de la génération'); return }
      const data = (await res.json()) as GenerateResponse
      if (data.attendanceWarning) {
        toast.warning(data.attendanceWarning.message, {
          description: data.attendanceWarning.detail ?? undefined,
        })
      }
      if (data.generating) {
        toast.success('Génération lancée — Claude travaille en arrière-plan')
        router.push(`/comptes-rendus/${data.id}`)
      } else {
        toast.success('Compte rendu créé')
        router.push(`/comptes-rendus/${data.id}`)
      }
    } finally {
      setGenerating(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Accueil production</p>
        <h1 className="text-2xl font-bold text-gray-900">Que faut-il traiter maintenant ?</h1>
        <p className="text-sm text-gray-500">
          La page priorise les réunions à transformer en PV, les brouillons à relire et les blocages à débloquer.
        </p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {workflowCards.map(({ title, value, href, description, icon: Icon, tone }) => (
          <Link
            key={title}
            href={href}
            className={`rounded-2xl border p-5 transition-transform hover:-translate-y-0.5 hover:shadow-sm ${tone}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium opacity-75">{title}</p>
                <p className="mt-2 text-4xl font-bold tabular-nums">{value}</p>
              </div>
              <Icon size={22} className="opacity-70" />
            </div>
            <p className="mt-3 text-xs opacity-75">{description}</p>
          </Link>
        ))}
      </section>

      {withoutMinutes.length === 0 && drafts.length === 0 && problemCount === 0 && generatingMeetings.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center gap-2.5">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>Aucune action urgente détectée : la file de production est à jour.</span>
        </div>
      )}

      {generatingMeetings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Loader2 size={18} className="animate-spin text-blue-500" />
            En cours de génération ({generatingMeetings.length})
          </h2>
          {generatingMeetings.map((m) => (
            <div
              key={m.id}
              onClick={() => m.minutes && router.push(`/comptes-rendus/${m.minutes.id}`)}
              className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-blue-100 transition-colors"
            >
              <Loader2 size={14} className="animate-spin text-blue-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-blue-900 truncate">{m.subject}</p>
                <p className="text-xs text-blue-600">Claude rédige le procès-verbal…</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">
            PV à relire ({drafts.length})
          </h2>
          {drafts.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onGenerate={handleGenerate}
              onTriggerBot={() => {}}
              generating={generating === m.id}
            />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          Réunions à traiter ({withoutMinutes.length})
        </h2>
        {withoutMinutes.length === 0 ? (
          <p className="text-sm text-gray-500">Toutes les réunions détectées ont déjà un PV.</p>
        ) : (
          withoutMinutes.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onGenerate={handleGenerate}
              onTriggerBot={() => {}}
              generating={generating === m.id}
            />
          ))
        )}
      </section>
    </div>
  )
}
