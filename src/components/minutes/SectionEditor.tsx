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
    const minRows = section.id === 'summary' ? 20 : 8
    return (
      <textarea
        value={value}
        onChange={(e) => {
          onChange({ ...content, [section.id]: e.target.value })
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        rows={minRows}
        style={{ minHeight: `${minRows * 1.6}rem` }}
        className="w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-700 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-y overflow-auto"
        placeholder={`Saisir ${section.label.toLowerCase()}…`}
      />
    )
  }

  if (section.id === 'actions' || section.type === 'table') {
    const actions = Array.isArray(content.actions) ? content.actions : []
    return (
      <div className="space-y-3">
        {actions.length > 0 && (
          <div className="grid grid-cols-[1fr_160px_140px_32px] gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 px-1">
            <span>Description</span>
            <span>Responsable</span>
            <span>Échéance</span>
            <span />
          </div>
        )}
        {actions.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_160px_140px_32px] gap-2 items-center">
            <input
              value={a.description}
              onChange={(e) => {
                const next = [...actions]
                next[i] = { ...next[i], description: e.target.value }
                onChange({ ...content, actions: next })
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              placeholder="Action à réaliser…"
            />
            <input
              value={a.responsable}
              onChange={(e) => {
                const next = [...actions]
                next[i] = { ...next[i], responsable: e.target.value }
                onChange({ ...content, actions: next })
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              placeholder="Responsable…"
            />
            <input
              value={a.echeance}
              type="date"
              onChange={(e) => {
                const next = [...actions]
                next[i] = { ...next[i], echeance: e.target.value }
                onChange({ ...content, actions: next })
              }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            <button
              onClick={() => onChange({ ...content, actions: actions.filter((_, j) => j !== i) })}
              className="text-gray-300 hover:text-red-500 flex items-center justify-center"
              aria-label="Supprimer"
            >
              <Trash2 size={15} />
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
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline mt-1"
        >
          <Plus size={14} /> Ajouter une action
        </button>
      </div>
    )
  }

  return null
}
