'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { Plus, Star, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardContent } from '@/components/ui'
import { TemplateEditor, type TemplateFormData } from '@/components/templates/TemplateEditor'
import { jsonFetcher } from '@/lib/swr'

export default function ParametresPage() {
  const { data: templates = [], mutate } = useSWR<TemplateFormData[]>('/api/templates', jsonFetcher)
  const [editing, setEditing] = useState<TemplateFormData | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleDelete(id: string) {
    if (!confirm('Supprimer ce template ?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    toast.success('Template supprimé')
    mutate()
  }

  if (creating || editing) {
    return (
      <div className="max-w-5xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {editing ? 'Modifier le template' : 'Nouveau template'}
        </h1>
        <Card>
          <CardContent className="p-6">
            <TemplateEditor
              initial={editing ?? undefined}
              onSaved={() => { setCreating(false); setEditing(null); mutate() }}
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
              <div className="flex items-center gap-3">
                {t.isDefault && <Star size={16} className="text-yellow-500" />}
                {t.logoBase64 && (
                  <img src={t.logoBase64} alt="" className="h-7 object-contain opacity-80" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">
                    {t.policeCorps} {t.taillePoliceCorps}pt
                    {' · '}
                    Marges {t.margeGaucheCm}/{t.margeDroiteCm} cm
                    {t.isDefault && ' · Par défaut'}
                    {!t.isActive && ' · Inactif'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => setEditing(t)}>
                  <Pencil size={16} />
                </Button>
                <Button variant="ghost" onClick={() => handleDelete(t.id!)}>
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
