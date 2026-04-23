'use client'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui'
import { Users, Mic, MicOff, Video, Bot, Loader2, AlertCircle } from 'lucide-react'
import type { MeetingPlatform, BotStatus } from '@prisma/client'

interface Meeting {
  id: string
  subject: string
  startDateTime: Date | string
  endDateTime: Date | string
  hasTranscription: boolean
  platform: MeetingPlatform
  botStatus: BotStatus | null
  participants: Array<{ name: string; email: string }>
  minutes?: { id: string; status: string } | null
}

interface MeetingCardProps {
  meeting: Meeting
  onGenerate: (meetingId: string) => void
  onTriggerBot: (meetingId: string) => void
  generating?: boolean
  triggeringBot?: boolean
}

const minutesStatusLabel: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'info' }> = {
  DRAFT:     { label: 'Brouillon', variant: 'warning' },
  VALIDATED: { label: 'Validé',    variant: 'info'    },
  SENT:      { label: 'Envoyé',    variant: 'success' },
}

const platformLabel: Record<MeetingPlatform, string> = {
  TEAMS_INTERNAL: 'Teams',
  TEAMS_EXTERNAL: 'Teams (externe)',
  ZOOM:           'Zoom',
  GOOGLE_MEET:    'Google Meet',
  OTHER:          'Visio',
}

function BotStatusBadge({ status }: { status: BotStatus | null }) {
  if (!status || status === 'DONE') return null

  const configs: Record<BotStatus, { label: string; icon: React.ReactNode; variant: 'default' | 'warning' | 'success' | 'destructive' }> = {
    SCHEDULED:  { label: 'Bot programmé',   icon: <Bot size={10} />,          variant: 'default' },
    JOINING:    { label: 'Bot connexion…',  icon: <Loader2 size={10} className="animate-spin" />, variant: 'default' },
    IN_MEETING: { label: 'Bot en réunion',  icon: <Loader2 size={10} className="animate-spin" />, variant: 'success' },
    PROCESSING: { label: 'Transcription…', icon: <Loader2 size={10} className="animate-spin" />, variant: 'default' },
    DONE:       { label: 'Compte rendu prêt', icon: null, variant: 'success' },
    FAILED:     { label: 'Bot échoué',      icon: <AlertCircle size={10} />,   variant: 'destructive' },
  }

  const { label, icon, variant } = configs[status]
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {label}
    </Badge>
  )
}

export function MeetingCard({ meeting, onGenerate, onTriggerBot, generating, triggeringBot }: MeetingCardProps) {
  const minutesStatus = meeting.minutes ? minutesStatusLabel[meeting.minutes.status] : null
  const isExternal = meeting.platform !== 'TEAMS_INTERNAL'
  const now = new Date()
  const meetingStarted = new Date(meeting.startDateTime) <= now
  const meetingEnded = new Date(meeting.endDateTime) <= now
  const botActive = meeting.botStatus === 'JOINING' || meeting.botStatus === 'IN_MEETING' || meeting.botStatus === 'PROCESSING'
  // Only show trigger button when bot is not already scheduled/running and no minutes yet
  const canTriggerBot = isExternal && !botActive && !meeting.minutes && meeting.botStatus !== 'SCHEDULED' && (meeting.botStatus === 'FAILED' || meeting.botStatus === null)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 truncate">{meeting.subject}</p>
          {isExternal && (
            <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
              <Video size={11} />
              {platformLabel[meeting.platform]}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-0.5">{formatDateTime(meeting.startDateTime)}</p>
        <div className="flex items-center gap-3 mt-2">
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Users size={12} />
            {meeting.participants.length} participants
          </span>
          {!isExternal && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              {meeting.hasTranscription ? (
                <Mic size={12} className="text-green-500" />
              ) : (
                <MicOff size={12} />
              )}
              {meeting.hasTranscription ? 'Transcription disponible' : 'Sans transcription'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        {minutesStatus && <Badge variant={minutesStatus.variant}>{minutesStatus.label}</Badge>}
        <BotStatusBadge status={meeting.botStatus} />

        {/* Actions */}
        {meeting.minutes ? (
          <a
            href={`/comptes-rendus/${meeting.minutes.id}`}
            className="text-sm text-blue-600 hover:underline"
          >
            Ouvrir
          </a>
        ) : botActive ? (
          // Bot is running — no action needed
          null
        ) : isExternal ? (
          // External meeting — trigger bot
          canTriggerBot && (
            <button
              onClick={() => onTriggerBot(meeting.id)}
              disabled={triggeringBot}
              className="text-sm text-blue-600 hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {triggeringBot ? (
                <><Loader2 size={12} className="animate-spin" /> Envoi du bot…</>
              ) : meetingStarted && !meetingEnded ? (
                <><Bot size={12} /> Envoyer le bot maintenant</>
              ) : !meetingStarted ? (
                <><Bot size={12} /> Bot programmé — rejoindre maintenant</>
              ) : (
                // Meeting ended but no minutes yet (bot failed or not triggered)
                'Créer le compte rendu'
              )}
            </button>
          )
        ) : (
          // Teams internal — manual generation
          <button
            onClick={() => onGenerate(meeting.id)}
            disabled={generating}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50"
          >
            {generating ? 'Génération…' : 'Créer le compte rendu'}
          </button>
        )}
      </div>
    </div>
  )
}
