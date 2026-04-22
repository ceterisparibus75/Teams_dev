'use client'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { MeetingCard } from '@/components/meetings/MeetingCard'

interface MeetingData {
  id: string
  subject: string
  startDateTime: string
  hasTranscription: boolean
  participants: Array<{ name: string; email: string }>
  minutes?: { id: string; status: string } | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [meetings, setMeetings] = useState<MeetingData[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/meetings')
      .then((r) => r.json())
      .then((data) => {
        setMeetings(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const drafts = meetings.filter((m) => m.minutes?.status === 'DRAFT')
  const withoutMinutes = meetings.filter((m) => !m.minutes)

  async function handleGenerate(meetingId: string) {
    setGenerating(meetingId)
    try {
      const res = await fetch(`/api/generate/${meetingId}`, { method: 'POST' })
      if (!res.ok) { toast.error('Erreur lors de la génération'); return }
      const data = await res.json()
      toast.success('Compte rendu généré')
      router.push(`/comptes-rendus/${data.id}`)
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
              generating={generating === m.id}
            />
          ))
        )}
      </section>
    </div>
  )
}
