'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
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
  botScheduledAt: string | null
  participants: Array<{ name: string; email: string }>
  minutes?: { id: string; status: string; generating: boolean } | null
}

interface GenerateResponse {
  id: string
  generating?: boolean
  attendanceWarning?: AttendanceWarning | null
}

export default function ReunionsPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<MeetingData[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [triggeringBot, setTriggeringBot] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/meetings')
      .then((r) => r.json())
      .then((data) => {
        setMeetings(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((err) => {
        console.error('[reunions] fetch error:', err)
        setLoading(false)
      })
  }, [])

  // Refresh bot status every 30 s while a bot is active
  useEffect(() => {
    const hasBotActive = meetings.some(
      (m) => m.botStatus === 'JOINING' || m.botStatus === 'IN_MEETING' || m.botStatus === 'PROCESSING'
    )
    if (!hasBotActive) return

    const interval = setInterval(() => {
      fetch('/api/meetings')
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setMeetings(data) })
        .catch(() => {})
    }, 30_000)

    return () => clearInterval(interval)
  }, [meetings])

  async function handleGenerate(meetingId: string) {
    setGenerating(meetingId)
    try {
      const res = await fetch(`/api/generate/${meetingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: 'detailed' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; code?: string; detail?: string }
        toast.error(err.error ?? 'Erreur lors de la génération', {
          description: [err.code, err.detail].filter(Boolean).join(' — ') || undefined,
        })
        return
      }
      const data = (await res.json()) as GenerateResponse
      if (data.attendanceWarning) {
        toast.warning(data.attendanceWarning.message, {
          description: data.attendanceWarning.detail ?? undefined,
        })
      }
      if (data.generating) {
        toast.success('Génération lancée — Claude rédige en arrière-plan')
      } else {
        toast.success('Compte rendu créé')
      }
      router.push(`/comptes-rendus/${data.id}`)
    } finally {
      setGenerating(null)
    }
  }

  async function handleTriggerBot(meetingId: string) {
    setTriggeringBot(meetingId)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/trigger-bot`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Impossible d\'envoyer le bot')
        return
      }
      toast.success('Bot envoyé — il rejoindra la réunion dans quelques instants')
      // Optimistically update UI
      setMeetings((prev) =>
        prev.map((m) => m.id === meetingId ? { ...m, botStatus: 'SCHEDULED' as BotStatus } : m)
      )
    } finally {
      setTriggeringBot(null)
    }
  }

  const withTranscription = meetings.filter((m) => m.hasTranscription)
  const withoutTranscription = meetings.filter((m) => !m.hasTranscription)

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Réunions</h1>

      {meetings.length === 0 && (
        <p className="text-sm text-gray-500">Aucune réunion trouvée dans les 7 derniers jours.</p>
      )}

      {withTranscription.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Transcription disponible ({withTranscription.length})
          </h2>
          {withTranscription.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onGenerate={handleGenerate}
              onTriggerBot={handleTriggerBot}
              generating={generating === m.id}
              triggeringBot={triggeringBot === m.id}
            />
          ))}
        </div>
      )}

      {withoutTranscription.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Sans transcription ({withoutTranscription.length})
          </h2>
          {withoutTranscription.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              onGenerate={handleGenerate}
              onTriggerBot={handleTriggerBot}
              generating={generating === m.id}
              triggeringBot={triggeringBot === m.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
