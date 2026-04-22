'use client'
import { useEffect, useState } from 'react'
import { Plus, Star, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardContent } from '@/components/ui'
import { TemplateEditor } from '@/components/templates/TemplateEditor'
import type { TemplateSection } from '@/types'

interface TemplateData {
  id: string
  name: string
  sections: TemplateSection[]
  footerHtml?: string
  isDefault: boolean
}

export default function ParametresPage() {
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [editing, setEditing] = useState<TemplateData | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    const data = await fetch('/api/templates').then((r) => r.json())
    setTemplates(Array.isArray(data) ? data : [])
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce template ?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    toast.success('Template supprimé')
    load()
  }

  if (creating || editing) {
    return (
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {editing ? 'Modifier le template' : 'Nouveau template'}
        </h1>
        <Card>
          <CardContent>
            <TemplateEditor
              initial={editing ?? undefined}
              onSaved={() => { setCreating(false); setEditing(null); load() }}
              onCancel={() => { setCreating(false); setEditing(null) }}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
        <Button onClick={() => setCreating(true)} className="flex items-center gap-2">
          <Plus size={16} /> Nouveau template
        </Button>
      </div>

      {templates.length === 0 && (
        <p className="text-sm text-gray-500">
          Aucun template. Créez-en un pour personnaliser vos comptes rendus.
        </p>
      )}

      <div className="space-y-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-2">
                {t.isDefault && <Star size={16} className="text-yellow-500" />}
                <p className="font-medium text-gray-900">{t.name}</p>
                <p className="text-sm text-gray-500">
                  — {(t.sections as TemplateSection[]).length} sections
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil size={16} />
                </Button>
                <Button variant="ghost" onClick={() => handleDelete(t.id)}>
                  <Trash2 size={16} className="text-red-500" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
