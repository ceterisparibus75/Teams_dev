'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Send, RefreshCw, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Badge } from '@/components/ui'
import { SectionEditor } from '@/components/minutes/SectionEditor'
import { SendModal } from '@/components/minutes/SendModal'
import { formatDateTime } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'

interface PromptOption {
  id: string
  nom: string
  contenu: string
  modeleClaude: string
}

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary', label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'actions', label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',   label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

const statusConfig: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'info' }> = {
  DRAFT:     { label: 'Brouillon', variant: 'warning' },
  VALIDATED: { label: 'Validé',    variant: 'info'    },
  SENT:      { label: 'Envoyé',    variant: 'success' },
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Panel de personnalisation IA
  const [showPromptPanel, setShowPromptPanel] = useState(false)
  const [prompts, setPrompts] = useState<PromptOption[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [customPromptText, setCustomPromptText] = useState<string>('')
  const [customModel, setCustomModel] = useState<string>('claude-opus-4-7')

  useEffect(() => {
    fetch(`/api/minutes/${id}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) { setLoadError(d.error ?? 'Compte rendu introuvable'); return }
        if (!d.content) { setLoadError('Le contenu de ce compte rendu est vide ou corrompu.'); return }
        setData(d as MinutesData)
        setContent(d.content as MinutesContent)
      })
      .catch(() => setLoadError('Impossible de charger le compte rendu.'))
  }, [id])

  const save = useCallback(
    async (newContent: MinutesContent) => {
      setSaving(true)
      await fetch(`/api/minutes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      })
      setSaving(false)
    },
    [id]
  )

  async function handleValidate() {
    setValidating(true)
    const res = await fetch(`/api/minutes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'VALIDATED' }),
    })
    if (res.ok) {
      toast.success('PV validé')
      setData((prev) => prev ? { ...prev, status: 'VALIDATED' } : prev)
    } else {
      toast.error('Erreur lors de la validation')
    }
    setValidating(false)
  }

  // Charge les prompts quand le panel s'ouvre
  useEffect(() => {
    if (!showPromptPanel || prompts.length > 0) return
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((list: PromptOption[]) => setPrompts(list))
      .catch(() => toast.error('Impossible de charger les prompts'))
  }, [showPromptPanel, prompts.length])

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

  async function handleRegenerate(useCustomParams = false) {
    if (!data) return
    setRegenerating(true)
    try {
      const body: Record<string, string> = {}
      if (useCustomParams && customPromptText.trim()) body.promptText = customPromptText.trim()
      if (useCustomParams && customModel) body.modelName = customModel
      const res = await fetch(`/api/generate/${data.meeting.id}/retranscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 space-y-3">
        <p className="text-sm font-semibold text-red-700">Impossible d'afficher ce compte rendu</p>
        <p className="text-sm text-red-600">{loadError}</p>
        <button onClick={() => router.back()} className="text-sm text-red-600 underline">← Retour</button>
      </div>
    )
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleRegenerate(false)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 border border-gray-200 rounded-l-lg px-3 py-1.5 hover:border-blue-300 transition-colors"
              >
                <RefreshCw size={12} />
                Régénérer le procès-verbal
              </button>
              <button
                onClick={() => setShowPromptPanel((v) => !v)}
                title="Personnaliser le prompt IA"
                className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-blue-600 border border-l-0 border-gray-200 rounded-r-lg px-2 py-1.5 hover:border-blue-300 transition-colors"
              >
                {showPromptPanel ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {showPromptPanel && !regenerating && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Paramètres IA — régénération</p>
          {prompts.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Prompt prédéfini</label>
              <select
                value={selectedPromptId}
                onChange={(e) => {
                  const p = prompts.find((pr) => pr.id === e.target.value)
                  setSelectedPromptId(e.target.value)
                  if (p) {
                    setCustomPromptText(p.contenu)
                    setCustomModel(p.modeleClaude)
                  }
                }}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— Prompt par défaut —</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.nom}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Instructions personnalisées (laisser vide = prompt par défaut)</label>
            <textarea
              value={customPromptText}
              onChange={(e) => setCustomPromptText(e.target.value)}
              rows={6}
              placeholder="Coller ou modifier ici les instructions pour Claude…"
              className="w-full text-xs font-mono border border-gray-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="space-y-1 flex-1">
              <label className="text-xs text-gray-500">Modèle Claude</label>
              <select
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="claude-opus-4-7">Claude Opus 4.7 (meilleur)</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (rapide)</option>
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (très rapide)</option>
              </select>
            </div>
            <button
              onClick={() => handleRegenerate(true)}
              className="mt-5 flex items-center gap-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 transition-colors shrink-0"
            >
              <RefreshCw size={14} />
              Régénérer avec ces paramètres
            </button>
          </div>
        </div>
      )}

      {content.notes?.includes('sans transcription') && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <strong>Aucune transcription Teams disponible</strong> — ce brouillon a été créé avec un contenu vide à compléter manuellement.
          Pour générer un vrai procès-verbal, démarrez la transcription dans la réunion Teams puis cliquez sur <strong>Régénérer le procès-verbal</strong>.
        </div>
      )}

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

      <div className="flex gap-3 pt-2 flex-wrap">
        <a href={`/api/export/${id}`} target="_blank" rel="noreferrer">
          <Button variant="outline" className="flex items-center gap-2">
            <Download size={16} /> Télécharger DOCX
          </Button>
        </a>
        {data.status === 'DRAFT' && (
          <Button
            onClick={handleValidate}
            disabled={validating}
            variant="outline"
            className="flex items-center gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <CheckCircle size={16} />
            {validating ? 'Validation…' : 'Valider le PV'}
          </Button>
        )}
        {(data.status === 'VALIDATED' || data.status === 'DRAFT') && (
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
