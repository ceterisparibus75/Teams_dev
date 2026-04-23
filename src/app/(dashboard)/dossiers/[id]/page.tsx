'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Link2, Unlink, FileText, ExternalLink, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { AttendanceWarning } from '@/lib/attendance-warning'
import type { TypeProcedure, StatutDossier } from '@prisma/client'

const PROCEDURE_LABELS: Record<string, string> = {
  MANDAT_AD_HOC:           'Mandat ad hoc',
  CONCILIATION:            'Conciliation',
  REDRESSEMENT_JUDICIAIRE: 'Redressement judiciaire',
  SAUVEGARDE:              'Sauvegarde',
}

const STATUT_OPTIONS: { value: StatutDossier; label: string }[] = [
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'CLOS',     label: 'Clos' },
  { value: 'ARCHIVE',  label: 'Archivé' },
]

const STATUT_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' }> = {
  EN_COURS: { label: 'En cours', variant: 'warning' },
  CLOS:     { label: 'Clos',     variant: 'success' },
  ARCHIVE:  { label: 'Archivé',  variant: 'default' },
}

const MINUTES_STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  DRAFT:     { label: 'Brouillon', variant: 'warning' },
  VALIDATED: { label: 'Validé',    variant: 'info'    },
  SENT:      { label: 'Envoyé',    variant: 'success' },
}

interface MeetingRef {
  id: string
  subject: string
  startDateTime: string
  endDateTime: string
  hasTranscription: boolean
  minutes: { id: string; status: string; summary: string | null } | null
}

function formatDuration(start: string, end: string): string {
  const totalMinutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (totalMinutes <= 0) return ''
  if (totalMinutes < 60) return `${totalMinutes} min`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`
}

interface DossierData {
  id: string
  reference: string
  denomination: string
  typeProcedure: TypeProcedure
  statut: StatutDossier
  _count: { meetings: number }
  meetings: MeetingRef[]
}

interface FreeMeeting {
  id: string
  subject: string
  startDateTime: string
}

interface GenerateResponse {
  id: string
  generating?: boolean
  attendanceWarning?: AttendanceWarning | null
}

export default function DossierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [dossier, setDossier] = useState<DossierData | null>(null)
  const [freeMeetings, setFreeMeetings] = useState<FreeMeeting[]>([])
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatingStatut, setUpdatingStatut] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  async function load() {
    const res = await fetch(`/api/dossiers/${id}`)
    if (!res.ok) { router.push('/dossiers'); return }
    const data: DossierData = await res.json()
    setDossier(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFreeMeetings() {
    const res = await fetch('/api/meetings?unlinked=1')
    if (res.ok) {
      const data = await res.json()
      setFreeMeetings(Array.isArray(data) ? data : [])
    }
    setShowLinkPanel(true)
  }

  async function handleStatutChange(statut: StatutDossier) {
    setUpdatingStatut(true)
    const res = await fetch(`/api/dossiers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statut }),
    })
    if (res.ok) {
      setDossier((prev) => prev ? { ...prev, statut } : prev)
      toast.success('Statut mis à jour')
    } else {
      toast.error('Erreur lors de la mise à jour')
    }
    setUpdatingStatut(false)
  }

  async function handleLink(meetingId: string) {
    setLinkingId(meetingId)
    const res = await fetch(`/api/dossiers/${id}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId }),
    })
    if (res.ok) {
      toast.success('Réunion associée')
      setShowLinkPanel(false)
      await load()
    } else {
      toast.error('Erreur lors de l\'association')
    }
    setLinkingId(null)
  }

  async function handleGenerate(meetingId: string) {
    setGeneratingId(meetingId)
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
      setGeneratingId(null)
    }
  }

  async function handleUnlink(meetingId: string) {
    setUnlinkingId(meetingId)
    const res = await fetch(`/api/dossiers/${id}/meetings`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId }),
    })
    if (res.ok) {
      toast.success('Réunion dissociée')
      await load()
    } else {
      toast.error('Erreur lors de la dissociation')
    }
    setUnlinkingId(null)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (!dossier) return null

  const statut = STATUT_CONFIG[dossier.statut]

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-start gap-4">
        <Link href="/dossiers" className="mt-1 text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-0.5">
              {dossier.reference}
            </span>
            <Badge variant={statut.variant}>{statut.label}</Badge>
            <span className="text-xs text-gray-400">{PROCEDURE_LABELS[dossier.typeProcedure]}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{dossier.denomination}</h1>
        </div>
      </div>

      {/* Changement de statut */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-medium text-gray-700 mb-3">Statut du dossier</p>
        <div className="flex gap-2 flex-wrap">
          {STATUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              disabled={updatingStatut || dossier.statut === opt.value}
              onClick={() => handleStatutChange(opt.value)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                dossier.statut === opt.value
                  ? 'bg-blue-600 text-white cursor-default'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Réunions associées */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Réunions ({dossier._count.meetings})
          </h2>
          <button
            onClick={showLinkPanel ? () => setShowLinkPanel(false) : loadFreeMeetings}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <Link2 size={15} />
            Associer une réunion
          </button>
        </div>

        {/* Panneau d'association manuelle */}
        {showLinkPanel && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-blue-800">
              Réunions disponibles (sans dossier associé)
            </p>
            {freeMeetings.length === 0 ? (
              <p className="text-sm text-blue-600">Toutes les réunions sont déjà associées à un dossier.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {freeMeetings.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-blue-100"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.subject}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(m.startDateTime)}</p>
                    </div>
                    <button
                      disabled={linkingId === m.id}
                      onClick={() => handleLink(m.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                    >
                      {linkingId === m.id ? 'Association…' : 'Associer'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Liste des réunions du dossier */}
        {dossier.meetings.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune réunion associée à ce dossier.</p>
        ) : (
          dossier.meetings.map((m) => {
            const latestMinutes = m.minutes
            const ms = latestMinutes ? MINUTES_STATUS[latestMinutes.status] : null
            return (
              <div
                key={m.id}
                className="flex items-start justify-between bg-white border border-gray-200 rounded-xl px-5 py-3.5 gap-4"
              >
                <div className="min-w-0 space-y-1 flex-1">
                  <p className="text-sm font-medium text-gray-900">{m.subject}</p>
                  <p className="text-xs text-gray-400">
                    {formatDateTime(m.startDateTime)}
                    {m.endDateTime && (
                      <span className="ml-2 text-gray-300">·</span>
                    )}
                    {m.endDateTime && (
                      <span className="ml-2">{formatDuration(m.startDateTime, m.endDateTime)}</span>
                    )}
                  </p>
                  {m.minutes?.summary && (
                    <p className="text-xs text-gray-500 leading-relaxed line-clamp-4 pt-0.5">
                      {m.minutes.summary}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 mt-0.5">
                  {ms && <Badge variant={ms.variant}>{ms.label}</Badge>}
                  {latestMinutes ? (
                    <Link
                      href={`/comptes-rendus/${latestMinutes.id}`}
                      className="text-gray-400 hover:text-blue-600 transition-colors"
                      title="Voir le compte rendu"
                    >
                      <FileText size={16} />
                    </Link>
                  ) : (
                    <button
                      disabled={generatingId === m.id}
                      onClick={() => handleGenerate(m.id)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                      title="Créer le compte rendu"
                    >
                      {generatingId === m.id ? (
                        <><Loader2 size={12} className="animate-spin" /> Génération…</>
                      ) : (
                        'Créer le CR'
                      )}
                    </button>
                  )}
                  <Link
                    href={`/reunions`}
                    className="text-gray-400 hover:text-blue-600 transition-colors"
                    title="Voir la réunion"
                  >
                    <ExternalLink size={15} />
                  </Link>
                  <button
                    disabled={unlinkingId === m.id}
                    onClick={() => handleUnlink(m.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Dissocier"
                  >
                    <Unlink size={15} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
