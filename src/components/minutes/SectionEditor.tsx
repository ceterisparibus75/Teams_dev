'use client'
import { Plus, Trash2 } from 'lucide-react'
import type { TemplateSection, MinutesContent } from '@/types'

interface Props {
  section: TemplateSection
  content: MinutesContent
  onChange: (content: MinutesContent) => void
}

export function SectionEditor({ section, content, onChange }: Props) {
  if (section.id === 'summary' || section.id === 'notes' || section.type === 'text') {
    const value = typeof content[section.id] === 'string' ? (content[section.id] as string) : ''
    return (
      <textarea
        value={value}
        onChange={(e) => onChange({ ...content, [section.id]: e.target.value })}
        rows={4}
        className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
        placeholder={`Saisir ${section.label.toLowerCase()}…`}
      />
    )
  }

  if (section.id === 'decisions' || section.type === 'list') {
    const decisions: string[] = Array.isArray(content.decisions) ? content.decisions : []
    return (
      <div className="space-y-2">
        {decisions.map((d, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={d}
              onChange={(e) => {
                const next = [...decisions]
                next[i] = e.target.value
                onChange({ ...content, decisions: next })
              }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              placeholder="Décision…"
            />
            <button
              onClick={() => onChange({ ...content, decisions: decisions.filter((_, j) => j !== i) })}
              className="text-gray-400 hover:text-red-500"
              aria-label="Supprimer"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange({ ...content, decisions: [...decisions, ''] })}
          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus size={14} /> Ajouter une décision
        </button>
      </div>
    )
  }

  if (section.id === 'actions' || section.type === 'table') {
    const actions = Array.isArray(content.actions) ? content.actions : []
    return (
      <div className="space-y-2">
        {actions.length > 0 && (
          <div className="grid grid-cols-3 gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 px-1">
            <span>Description</span>
            <span>Responsable</span>
            <span>Échéance</span>
          </div>
        )}
        {actions.map((a, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 items-center">
            {(['description', 'responsable', 'echeance'] as const).map((field) => (
              <input
                key={field}
                value={a[field]}
                type={field === 'echeance' ? 'date' : 'text'}
                onChange={(e) => {
                  const next = [...actions]
                  next[i] = { ...next[i], [field]: e.target.value }
                  onChange({ ...content, actions: next })
                }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            ))}
            <button
              onClick={() => onChange({ ...content, actions: actions.filter((_, j) => j !== i) })}
              className="text-gray-400 hover:text-red-500 col-span-1 flex justify-end"
              aria-label="Supprimer"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            onChange({
              ...content,
              actions: [...actions, { description: '', responsable: '', echeance: '' }],
            })
          }
          className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <Plus size={14} /> Ajouter une action
        </button>
      </div>
    )
  }

  return null
}
