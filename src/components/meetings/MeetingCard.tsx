'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui'
import { Users, Mic, MicOff, RefreshCw, FileText, AlignLeft } from 'lucide-react'

interface Meeting {
  id: string
  subject: string
  startDateTime: Date | string
  hasTranscription: boolean
  participants: Array<{ name: string; email: string }>
  minutes?: { id: string; status: string } | null
}

interface MeetingCardProps {
  meeting: Meeting
  onGenerate: (meetingId: string, style: 'detailed' | 'concise') => void
  generating?: boolean
}

const statusLabel: Record<string, { label: string; variant: 'default' | 'warning' | 'success' }> = {
  DRAFT:    { label: 'Brouillon',       variant: 'warning' },
  REVIEWED: { label: 'Prêt à envoyer', variant: 'default' },
  SENT:     { label: 'Envoyé',          variant: 'success' },
}

export function MeetingCard({ meeting, onGenerate, generating }: MeetingCardProps) {
  const [retranscribing, setRetranscribing] = useState(false)
  const status = meeting.minutes ? statusLabel[meeting.minutes.status] : null

  async function handleRetranscribe(style: 'detailed' | 'concise') {
    setRetranscribing(true)
    try {
      const res = await fetch(`/api/generate/${meeting.id}/retranscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style }),
      })
      if (res.ok) {
        toast.success('Compte rendu mis à jour avec la transcription')
        window.location.reload()
      } else {
        const { error } = await res.json()
        toast.error(error ?? 'Erreur lors de la récupération de la transcription')
      }
    } finally {
      setRetranscribing(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{meeting.subject}</p>
        <p className="text-sm text-gray-500 mt-0.5">{formatDateTime(meeting.startDateTime)}</p>
        <div className="flex items-center gap-3 mt-2">
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Users size={12} />
            {meeting.participants.length} participants
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            {meeting.hasTranscription ? (
              <Mic size={12} className="text-green-500" />
            ) : (
              <MicOff size={12} />
            )}
            {meeting.hasTranscription ? 'Transcription disponible' : 'Sans transcription'}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        {status && <Badge variant={status.variant}>{status.label}</Badge>}

        {!meeting.minutes ? (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => onGenerate(meeting.id, 'detailed')}
              disabled={generating}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline disabled:opacity-50"
            >
              <FileText size={13} />
              {generating ? 'Génération…' : 'Compte rendu développé'}
            </button>
            <button
              onClick={() => onGenerate(meeting.id, 'concise')}
              disabled={generating}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 hover:underline disabled:opacity-50"
            >
              <AlignLeft size={13} />
              {generating ? 'Génération…' : 'Compte rendu synthétique'}
            </button>
          </div>
        ) : (
          <a
            href={`/comptes-rendus/${meeting.minutes.id}`}
            className="text-sm text-blue-600 hover:underline"
          >
            Ouvrir
          </a>
        )}

        {meeting.minutes && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => handleRetranscribe('detailed')}
              disabled={retranscribing}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 disabled:opacity-50"
            >
              <RefreshCw size={11} className={retranscribing ? 'animate-spin' : ''} />
              Actualiser — développé
            </button>
            <button
              onClick={() => handleRetranscribe('concise')}
              disabled={retranscribing}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 disabled:opacity-50"
            >
              <RefreshCw size={11} />
              Actualiser — synthétique
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
