'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { TypeProcedure } from '@prisma/client'

const PROCEDURE_OPTIONS: { value: TypeProcedure; label: string }[] = [
  { value: 'MANDAT_AD_HOC',           label: 'Mandat ad hoc' },
  { value: 'CONCILIATION',            label: 'Conciliation' },
  { value: 'REDRESSEMENT_JUDICIAIRE', label: 'Redressement judiciaire' },
  { value: 'SAUVEGARDE',              label: 'Sauvegarde' },
]

export default function NouveauDossierPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    reference: '',
    denomination: '',
    typeProcedure: '' as TypeProcedure | '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.reference.trim() || !form.denomination.trim() || !form.typeProcedure) {
      toast.error('Veuillez remplir tous les champs')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la création')
        return
      }
      const linked = data.linkedMeetings as number
      toast.success(
        linked > 0
          ? `Dossier créé — ${linked} réunion${linked > 1 ? 's' : ''} associée${linked > 1 ? 's' : ''} automatiquement`
          : 'Dossier créé'
      )
      router.push('/dossiers')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link href="/dossiers" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Nouveau dossier</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="reference">
            Référence interne
          </label>
          <input
            id="reference"
            name="reference"
            type="text"
            required
            placeholder="ex. 2024-001"
            value={form.reference}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400">Identifiant unique du dossier dans le cabinet</p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="denomination">
            Dénomination sociale
          </label>
          <input
            id="denomination"
            name="denomination"
            type="text"
            required
            placeholder="ex. Société XYZ SAS"
            value={form.denomination}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400">
            Utilisée pour associer automatiquement les réunions dont le sujet contient ce nom
          </p>
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700" htmlFor="typeProcedure">
            Type de procédure
          </label>
          <select
            id="typeProcedure"
            name="typeProcedure"
            required
            value={form.typeProcedure}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">— Sélectionner —</option>
            {PROCEDURE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Création en cours…' : 'Créer le dossier'}
        </button>
      </form>
    </div>
  )
}
