'use client'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { toast } from 'sonner'
import type { TemplateSection } from '@/types'

interface TemplateData {
  id?: string
  name: string
  sections: TemplateSection[]
  footerHtml?: string
  isDefault?: boolean
}

interface Props {
  initial?: TemplateData
  onSaved: () => void
  onCancel: () => void
}

const SECTION_TYPES: TemplateSection['type'][] = ['text', 'list', 'table']

const DEFAULT_SECTIONS: TemplateSection[] = [
  { id: 'summary',   label: 'Résumé',               type: 'text',  aiGenerated: true  },
  { id: 'decisions', label: 'Décisions',             type: 'list',  aiGenerated: true  },
  { id: 'actions',   label: 'Actions à suivre',      type: 'table', aiGenerated: true  },
  { id: 'notes',     label: 'Notes complémentaires', type: 'text',  aiGenerated: false },
]

export function TemplateEditor({ initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [sections, setSections] = useState<TemplateSection[]>(
    initial?.sections ?? DEFAULT_SECTIONS
  )
  const [footerHtml, setFooterHtml] = useState(initial?.footerHtml ?? '')
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false)
  const [saving, setSaving] = useState(false)

  function addSection() {
    setSections((prev) => [
      ...prev,
      { id: `section_${Date.now()}`, label: 'Nouvelle section', type: 'text', aiGenerated: false },
    ])
  }

  function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id))
  }

  function updateSection(id: string, field: keyof TemplateSection, value: unknown) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)))
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Nom du template requis'); return }
    setSaving(true)

    const url = initial?.id ? `/api/templates/${initial.id}` : '/api/templates'
    const method = initial?.id ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sections, footerHtml, isDefault }),
    })

    setSaving(false)
    if (!res.ok) { toast.error('Erreur lors de la sauvegarde'); return }
    toast.success('Template sauvegardé')
    onSaved()
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="template-name">
          Nom du template
        </label>
        <input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          placeholder="Ex : Réunion créanciers"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Sections</p>
        {sections.map((s) => (
          <div key={s.id} className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
            <input
              value={s.label}
              onChange={(e) => updateSection(s.id, 'label', e.target.value)}
              className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <select
              value={s.type}
              onChange={(e) => updateSection(s.id, 'type', e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-sm bg-white"
            >
              {SECTION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
              <input
                type="checkbox"
                checked={s.aiGenerated}
                onChange={(e) => updateSection(s.id, 'aiGenerated', e.target.checked)}
                className="rounded border-gray-300"
              />
              IA
            </label>
            <button
              onClick={() => removeSection(s.id)}
              className="text-gray-400 hover:text-red-500"
              aria-label="Supprimer la section"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={addSection}
          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus size={14} /> Ajouter une section
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700" htmlFor="footer">
          Pied de page DOCX
        </label>
        <textarea
          id="footer"
          value={footerHtml}
          onChange={(e) => setFooterHtml(e.target.value)}
          rows={2}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          placeholder="SELAS BL & Associés — Administrateurs Judiciaires"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="rounded border-gray-300 text-blue-600"
        />
        Appliquer automatiquement à toutes les nouvelles réunions
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Annuler</Button>
        <Button onClick={handleSave} loading={saving}>Enregistrer</Button>
      </div>
    </div>
  )
}
