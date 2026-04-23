'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Send, RefreshCw } from 'lucide-react'
import { Button, Badge } from '@/components/ui'
import { SectionEditor } from '@/components/minutes/SectionEditor'
import { SendModal } from '@/components/minutes/SendModal'
import { formatDateTime } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary', label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'actions', label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',   label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

const statusConfig: Record<string, { label: string; variant: 'default' | 'warning' | 'success' }> = {
  DRAFT:    { label: 'Brouillon',       variant: 'warning' },
  REVIEWED: { label: 'Prêt à envoyer', variant: 'default' },
  SENT:     { label: 'Envoyé',          variant: 'success' },
}

interface MinutesData {
  id: string
  meetingId: string
  status: string
  content: MinutesContent
  template?: { sections: TemplateSection[] } | null
  meeting: {
    id: string
    subject: string
    startDateTime: string
    participants: Array<{ name: string; email: string }>
  }
  author: { name: string }
}

interface ApiErrorPayload {
  error?: string
  code?: string
  detail?: string | null
}

export default function MinutesDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<MinutesData | null>(null)
  const [content, setContent] = useState<MinutesContent | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch(`/api/minutes/${id}`)
      .then((r) => r.json())
      .then((d: MinutesData) => {
        setData(d)
        setContent(d.content)
      })
  }, [id])

  const save = useCallback(
    async (newContent: MinutesContent) => {
      setSaving(true)
      await fetch(`/api/minutes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent, status: 'REVIEWED' }),
      })
      setSaving(false)
    },
    [id]
  )

  // Autosave every 30s
  useEffect(() => {
    if (!content) return
    const timer = setTimeout(() => save(content), 30_000)
    return () => clearTimeout(timer)
  }, [content, save])

  useEffect(() => {
    if (regenerating) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [regenerating])

  async function handleRegenerate() {
    if (!data) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/generate/${data.meeting.id}/retranscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = (await res.json()) as ApiErrorPayload
        toast.error(err.error ?? 'Erreur lors de la régénération', {
          description: [err.code, err.detail].filter(Boolean).join(' - ') || undefined,
        })
        return
      }
      toast.success('Compte rendu régénéré')
      router.refresh()
      // Reload fresh content
      const fresh = await fetch(`/api/minutes/${id}`).then(r => r.json())
      setData(fresh)
      setContent(fresh.content)
    } finally {
      setRegenerating(false)
    }
  }

  async function handleSend(recipients: Array<{ name: string; email: string }>) {
    if (!content) return
    await save(content)
    const res = await fetch(`/api/send/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients }),
    })
    if (!res.ok) { toast.error("Erreur lors de l'envoi"); return }
    toast.success('Compte rendu envoyé aux participants')
    setData((prev) => prev ? { ...prev, status: 'SENT' } : prev)
  }

  if (!data || !content) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  const sections: TemplateSection[] = data.template?.sections ?? DEFAULT_SECTIONS
  const status = statusConfig[data.status] ?? statusConfig['DRAFT']
  const hasPVSections = (content.sections?.length ?? 0) > 0
  const ACTION_SECTION: TemplateSection = { id: 'actions', label: 'Actions à suivre', type: 'table', aiGenerated: true }
  const NOTES_SECTION: TemplateSection = { id: 'notes', label: 'Notes complémentaires', type: 'text', aiGenerated: false }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">{data.meeting.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateTime(data.meeting.startDateTime)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {saving && <span className="text-xs text-gray-400">Sauvegarde…</span>}
          </div>
          {regenerating ? (
            <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <RefreshCw size={12} className="animate-spin shrink-0" />
              <span>
                Claude Opus rédige le procès-verbal…{' '}
                <span className="font-mono font-semibold tabular-nums">{elapsed}s</span>
                <span className="text-blue-400 ml-1">(1 à 2 min)</span>
              </span>
            </div>
          ) : (
            <button
              onClick={handleRegenerate}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors"
            >
              <RefreshCw size={12} />
              Régénérer le procès-verbal
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Participants : {data.meeting.participants.map((p) => p.name).join(', ')}
      </p>

      {hasPVSections ? (
        <>
          {content.summary && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Résumé</h2>
              <textarea
                value={content.summary}
                onChange={(e) => {
                  setContent({ ...content, summary: e.target.value })
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                rows={5}
                style={{ minHeight: '5rem' }}
                className="w-full bg-transparent border border-blue-200 rounded-lg p-3 text-sm text-gray-700 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 resize-y overflow-auto"
              />
            </div>
          )}
          {content.sections!.map((pvSection, i) => (
            <div key={pvSection.numero} className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {pvSection.numero}- {pvSection.titre}
              </h2>
              <textarea
                value={pvSection.contenu}
                onChange={(e) => {
                  const newSections = content.sections!.map((s, j) =>
                    j === i ? { ...s, contenu: e.target.value } : s
                  )
                  setContent({ ...content, sections: newSections })
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                rows={12}
                style={{ minHeight: '12rem' }}
                className="w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-700 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-y overflow-auto font-mono"
              />
            </div>
          ))}
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Actions à suivre</h2>
            <SectionEditor section={ACTION_SECTION} content={content} onChange={setContent} />
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Notes complémentaires</h2>
            <SectionEditor section={NOTES_SECTION} content={content} onChange={setContent} />
          </div>
        </>
      ) : (
        sections.map((section) => (
          <div
            key={section.id}
            className="bg-white border border-gray-200 rounded-xl p-6 space-y-3"
          >
            <h2 className="text-lg font-semibold text-gray-900">{section.label}</h2>
            <SectionEditor section={section} content={content} onChange={setContent} />
          </div>
        ))
      )}

      <div className="flex gap-3 pt-2">
        <a href={`/api/export/${id}`} target="_blank" rel="noreferrer">
          <Button variant="outline" className="flex items-center gap-2">
            <Download size={16} /> Télécharger DOCX
          </Button>
        </a>
        {data.status !== 'SENT' && (
          <Button
            onClick={() => setSendOpen(true)}
            className="flex items-center gap-2"
          >
            <Send size={16} /> Envoyer aux participants
          </Button>
        )}
      </div>

      <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onConfirm={handleSend}
        participants={data.meeting.participants}
        subject={data.meeting.subject}
      />
    </div>
  )
}
