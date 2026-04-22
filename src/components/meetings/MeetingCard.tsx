import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui'
import { Users, Mic, MicOff } from 'lucide-react'

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
  onGenerate: (meetingId: string) => void
  generating?: boolean
}

const statusLabel: Record<string, { label: string; variant: 'default' | 'warning' | 'success' }> = {
  DRAFT:    { label: 'Brouillon',       variant: 'warning' },
  REVIEWED: { label: 'Prêt à envoyer', variant: 'default' },
  SENT:     { label: 'Envoyé',          variant: 'success' },
}

export function MeetingCard({ meeting, onGenerate, generating }: MeetingCardProps) {
  const status = meeting.minutes ? statusLabel[meeting.minutes.status] : null

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
          <button
            onClick={() => onGenerate(meeting.id)}
            disabled={generating}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50"
          >
            {generating ? 'Génération…' : 'Créer le compte rendu'}
          </button>
        ) : (
          <a
            href={`/comptes-rendus/${meeting.minutes.id}`}
            className="text-sm text-blue-600 hover:underline"
          >
            Ouvrir
          </a>
        )}
      </div>
    </div>
  )
}
