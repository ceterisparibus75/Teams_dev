'use client'
import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { MeetingCard } from '@/components/meetings/MeetingCard'
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

export default function DashboardPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<MeetingData[]>([])
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

  useEffect(() => {
    loadMeetings().finally(() => setLoading(false))
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

  async function handleGenerate(meetingId: string) {
    setGenerating(meetingId)
    try {
      const res = await fetch(`/api/generate/${meetingId}`, { method: 'POST' })
      if (!res.ok) { toast.error('Erreur lors de la génération'); return }
      const data = await res.json()
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
      <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>

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
            À relire ({drafts.length})
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
          Réunions récentes sans compte rendu ({withoutMinutes.length})
        </h2>
        {withoutMinutes.length === 0 ? (
          <p className="text-sm text-gray-500">Toutes les réunions ont un compte rendu.</p>
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
