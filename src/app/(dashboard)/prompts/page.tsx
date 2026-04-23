'use client'
import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, CheckCircle, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardContent, Badge } from '@/components/ui'
import { PromptEditor, type PromptFormData } from '@/components/prompts/PromptEditor'

interface PromptData extends PromptFormData {
  id: string
  version: number
  createdAt: string
  _count: { minutes: number }
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptData[]>([])
  const [editing, setEditing] = useState<PromptData | null>(null)
  const [creating, setCreating] = useState(false)

  async function load() {
    const data = await fetch('/api/prompts').then((r) => r.json())
    setPrompts(Array.isArray(data) ? data : [])
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string, nom: string) {
    if (!confirm(`Supprimer le prompt « ${nom} » ?`)) return
    await fetch(`/api/prompts/${id}`, { method: 'DELETE' })
    toast.success('Prompt supprimé')
    load()
  }

  async function handleToggleActive(p: PromptData) {
    await fetch(`/api/prompts/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    })
    load()
  }

  if (creating || editing) {
    return (
      <div className="max-w-4xl space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {editing ? 'Modifier le prompt' : 'Nouveau prompt'}
        </h1>
        <Card>
          <CardContent className="p-6">
            <PromptEditor
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Prompts IA</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Personnalisez les instructions transmises à Claude pour la génération des PV
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="flex items-center gap-2">
          <Plus size={16} /> Nouveau prompt
        </Button>
      </div>

      {prompts.length === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center space-y-2">
          <p className="text-sm font-medium text-gray-600">Aucun prompt personnalisé</p>
          <p className="text-xs text-gray-400">
            Le prompt par défaut intégré à l&apos;application est utilisé pour toutes les générations.
            Créez un prompt pour l&apos;adapter à vos procédures.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {prompts.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => handleToggleActive(p)}
                  className={`flex-shrink-0 transition-colors ${p.isActive ? 'text-green-500' : 'text-gray-300 hover:text-gray-400'}`}
                  title={p.isActive ? 'Actif — cliquer pour désactiver' : 'Inactif — cliquer pour activer'}
                >
                  {p.isActive ? <CheckCircle size={18} /> : <Circle size={18} />}
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 truncate">{p.nom}</p>
                    <Badge variant={p.isActive ? 'success' : 'default'}>
                      {p.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {p.modeleClaude}
                    {' · '}
                    v{p.version}
                    {' · '}
                    {p._count.minutes} PV généré{p._count.minutes !== 1 ? 's' : ''}
                    {' · '}
                    {p.contenu.length} car.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  <Pencil size={16} />
                </Button>
                <Button variant="ghost" onClick={() => handleDelete(p.id, p.nom)}>
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
