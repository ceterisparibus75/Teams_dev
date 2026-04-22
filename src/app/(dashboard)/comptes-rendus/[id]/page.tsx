'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Send } from 'lucide-react'
import { Button, Badge } from '@/components/ui'
import { SectionEditor } from '@/components/minutes/SectionEditor'
import { SendModal } from '@/components/minutes/SendModal'
import { formatDateTime } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary',   label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'decisions', label: 'Décisions',             type: 'list',  aiGenerated: true  },
  { id: 'actions',   label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',     label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

const statusConfig: Record<string, { label: string; variant: 'default' | 'warning' | 'success' }> = {
  DRAFT:    { label: 'Brouillon',       variant: 'warning' },
  REVIEWED: { label: 'Prêt à envoyer', variant: 'default' },
  SENT:     { label: 'Envoyé',          variant: 'success' },
}

interface MinutesData {
  id: string
  status: string
  content: MinutesContent
  template?: { sections: TemplateSection[] } | null
  meeting: {
    subject: string
    startDateTime: string
    participants: Array<{ name: string; email: string }>
  }
  author: { name: string }
}

export default function MinutesDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<MinutesData | null>(null)
  const [content, setContent] = useState<MinutesContent | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [saving, setSaving] = useState(false)

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

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.meeting.subject}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatDateTime(data.meeting.startDateTime)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {saving && <span className="text-xs text-gray-400">Sauvegarde…</span>}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Participants : {data.meeting.participants.map((p) => p.name).join(', ')}
      </p>

      {sections.map((section) => (
        <div
          key={section.id}
          className="bg-white border border-gray-200 rounded-xl p-6 space-y-3"
        >
          <h2 className="text-lg font-semibold text-gray-900">{section.label}</h2>
          <SectionEditor section={section} content={content} onChange={setContent} />
        </div>
      ))}

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
