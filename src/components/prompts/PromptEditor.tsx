'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { ChevronDown, ChevronUp, FlaskConical } from 'lucide-react'
import type { MinutesContent } from '@/types'

const MODELS = [
  { value: 'claude-opus-4-7',          label: 'Claude Opus 4.7 — le plus précis' },
  { value: 'claude-sonnet-4-6',        label: 'Claude Sonnet 4.6 — équilibré' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — le plus rapide' },
]

export interface PromptFormData {
  id?: string
  nom: string
  typeDocument: string
  contenu: string
  modeleClaude: string
  isActive: boolean
}

const DEFAULT_FORM: PromptFormData = {
  nom: '',
  typeDocument: 'pv_reunion',
  contenu: '',
  modeleClaude: 'claude-opus-4-7',
  isActive: true,
}

interface Props {
  initial?: Partial<PromptFormData>
  onSaved: () => void
  onCancel: () => void
}

function parseTestParticipants(raw: string): Array<{ name: string; email?: string; company?: string }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const emailMatch = line.match(/<([^>]+)>/)
      const email = emailMatch?.[1]?.trim()
      const normalized = line.replace(/\s*<[^>]+>\s*/, ' ').trim()
      const [namePart, ...companyParts] = normalized.split(/\s+[—–]\s+|\s+-\s+/)
      const name = namePart?.trim() ?? ''
      const company = companyParts.join(' — ').trim() || undefined
      return {
        name,
        email: email || undefined,
        company,
      }
    })
    .filter((participant) => participant.name.length > 0)
}

export function PromptEditor({ initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<PromptFormData>({ ...DEFAULT_FORM, ...initial })
  const [saving, setSaving] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [testSujet, setTestSujet] = useState('')
  const [testMeetingDate, setTestMeetingDate] = useState('')
  const [testParticipants, setTestParticipants] = useState('')
  const [testTranscription, setTestTranscription] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<MinutesContent | null>(null)

  const set = <K extends keyof PromptFormData>(key: K, value: PromptFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function handleSave() {
    if (!form.nom.trim()) { toast.error('Nom requis'); return }
    if (!form.contenu.trim()) { toast.error('Contenu du prompt requis'); return }
    setSaving(true)
    const url = form.id ? `/api/prompts/${form.id}` : '/api/prompts'
    const method = form.id ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) { toast.error('Erreur lors de la sauvegarde'); return }
    toast.success('Prompt sauvegardé')
    onSaved()
  }

  async function handleTest() {
    if (!testSujet.trim() || !testTranscription.trim()) {
      toast.error('Veuillez renseigner le sujet et la transcription de test')
      return
    }
    const parsedParticipants = parseTestParticipants(testParticipants)
    setTesting(true)
    setTestResult(null)
    const res = await fetch('/api/prompts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sujet: testSujet,
        transcription: testTranscription,
        promptText: form.contenu || undefined,
        modeleClaude: form.modeleClaude,
        participants: parsedParticipants.length ? parsedParticipants : undefined,
        meetingDate: testMeetingDate || undefined,
      }),
    })
    setTesting(false)
    if (!res.ok) { toast.error('Erreur lors du test'); return }
    const data: MinutesContent = await res.json()
    setTestResult(data)
    toast.success('Test terminé — résultat affiché ci-dessous')
  }

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2 space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-nom">
            Nom du prompt
          </label>
          <input
            id="prompt-nom"
            value={form.nom}
            onChange={(e) => set('nom', e.target.value)}
            placeholder="ex. PV standard procédure de conciliation"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-model">
            Modèle Claude
          </label>
          <select
            id="prompt-model"
            value={form.modeleClaude}
            onChange={(e) => set('modeleClaude', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
          className="rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm text-gray-700">Prompt actif (proposé lors de la génération)</span>
      </label>

      {/* Contenu */}
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-contenu">
            Contenu du prompt système
          </label>
          <span className="text-xs text-gray-400">{form.contenu.length} caractères</span>
        </div>
        <textarea
          id="prompt-contenu"
          value={form.contenu}
          onChange={(e) => set('contenu', e.target.value)}
          rows={20}
          placeholder="Vous êtes un expert juridique spécialisé dans les procédures d'insolvabilité françaises…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          spellCheck={false}
        />
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
          <p className="font-medium">Ce prompt remplace le prompt système par défaut.</p>
          <p>Il est transmis à Claude avant la transcription. Ne pas y inclure la transcription elle-même — elle est ajoutée automatiquement.</p>
          <p className="text-blue-500">Laissez le contenu vide pour utiliser le prompt par défaut intégré à l&apos;application.</p>
        </div>
      </div>

      {/* Panneau de test */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setTestOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
        >
          <span className="flex items-center gap-2">
            <FlaskConical size={15} />
            Tester ce prompt sur une transcription
          </span>
          {testOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {testOpen && (
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="test-sujet">
                Sujet de la réunion
              </label>
              <input
                id="test-sujet"
                value={testSujet}
                onChange={(e) => setTestSujet(e.target.value)}
                placeholder="ex. Réunion créanciers — Société ABC SAS"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700" htmlFor="test-meeting-date">
                  Date de la réunion
                </label>
                <input
                  id="test-meeting-date"
                  type="datetime-local"
                  value={testMeetingDate}
                  onChange={(e) => setTestMeetingDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500">
                  Optionnel, mais recommandé pour reproduire le contexte réel.
                </p>
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700" htmlFor="test-participants">
                  Participants (format Teams)
                </label>
                <textarea
                  id="test-participants"
                  value={testParticipants}
                  onChange={(e) => setTestParticipants(e.target.value)}
                  rows={4}
                  placeholder={`Maxime Langet <maxime.langet@bl-aj.fr> — SELAS BL & Associés\nKarim Bent-Mohamed <kbm@ikki-partners.com> — Ikki Partners`}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
                <p className="text-xs text-gray-500">
                  Une ligne par participant : <span className="font-mono">Nom &lt;email&gt; — société/qualité</span>.
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="test-transcript">
                Transcription (coller ici)
              </label>
              <textarea
                id="test-transcript"
                value={testTranscription}
                onChange={(e) => setTestTranscription(e.target.value)}
                rows={8}
                placeholder="00:00:05 John Doe: Bonjour à tous, je déclare la réunion ouverte…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
            </div>
            <Button onClick={handleTest} loading={testing} variant="outline">
              Lancer le test
            </Button>

            {testResult && (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium text-gray-700">Résultat généré :</p>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3 text-sm">
                  {testResult.summary && (
                    <div>
                      <p className="font-medium text-gray-600 mb-1">Résumé</p>
                      <p className="text-gray-800 whitespace-pre-wrap">{testResult.summary}</p>
                    </div>
                  )}
                  {testResult.actions && testResult.actions.length > 0 && (
                    <div>
                      <p className="font-medium text-gray-600 mb-1">Actions ({testResult.actions.length})</p>
                      <ul className="list-disc list-inside space-y-0.5 text-gray-700">
                        {testResult.actions.map((a, i) => (
                          <li key={i}>{a.description} — <span className="text-gray-400">{a.responsable}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {testResult.notes && (
                    <div>
                      <p className="font-medium text-gray-600 mb-1">Notes</p>
                      <p className="text-gray-700 whitespace-pre-wrap">{testResult.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Boutons */}
      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <Button variant="outline" onClick={onCancel}>Annuler</Button>
        <Button onClick={handleSave} loading={saving}>Enregistrer</Button>
      </div>
    </div>
  )
}
