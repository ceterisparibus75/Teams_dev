'use client'
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { Plus, Trash2, Upload, X } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'general' | 'entete' | 'typographie' | 'couleurs' | 'mise_en_page'

export interface TemplateFormData {
  id?: string
  name: string
  isDefault: boolean
  isActive: boolean
  logoBase64: string | null
  logoLargeurCm: number
  enteteTexteLignes: string[]
  enteteAlignement: string
  piedPageLignes: string[]
  piedPageAlignement: string
  numeroterPages: boolean
  formatNumerotation: string
  policeCorps: string
  taillePoliceCorps: number
  policeTitres: string
  taillePoliceTitre1: number
  taillePoliceTitre2: number
  couleurTitres: string
  couleurCorps: string
  couleurEnteteCabinet: string
  couleurEnteteTableau: string
  couleurBordureTableau: string
  margeHautCm: number
  margeBasCm: number
  margeGaucheCm: number
  margeDroiteCm: number
  interligne: number
  justifierCorps: boolean
}

const DEFAULT_FORM: TemplateFormData = {
  name: '',
  isDefault: false,
  isActive: true,
  logoBase64: null,
  logoLargeurCm: 3.0,
  enteteTexteLignes: ['SELAS BL & Associés', 'Administrateurs Judiciaires'],
  enteteAlignement: 'droite',
  piedPageLignes: ['BL & Associés — Administrateurs Judiciaires'],
  piedPageAlignement: 'centre',
  numeroterPages: true,
  formatNumerotation: 'Page {n} sur {total}',
  policeCorps: 'Utsaah',
  taillePoliceCorps: 11,
  policeTitres: 'Utsaah',
  taillePoliceTitre1: 14,
  taillePoliceTitre2: 12,
  couleurTitres: '6AAFAB',
  couleurCorps: '2C2C2C',
  couleurEnteteCabinet: '6AAFAB',
  couleurEnteteTableau: 'E5F5F4',
  couleurBordureTableau: 'AFDAD7',
  margeHautCm: 2.5,
  margeBasCm: 2.5,
  margeGaucheCm: 2.5,
  margeDroiteCm: 2.5,
  interligne: 1.15,
  justifierCorps: true,
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'general',      label: 'Général' },
  { id: 'entete',       label: 'En-tête & Pied' },
  { id: 'typographie',  label: 'Typographie' },
  { id: 'couleurs',     label: 'Couleurs' },
  { id: 'mise_en_page', label: 'Mise en page' },
]

const FONTS = ['Utsaah', 'Cambria', 'Calibri', 'Arial', 'Times New Roman', 'Georgia']

// Migration : corrige les valeurs héritées de l'ancienne charte graphique
function applyLegacyMigration(data: Partial<TemplateFormData>): Partial<TemplateFormData> {
  const m = { ...data }
  if (m.policeCorps === 'Cambria') m.policeCorps = 'Utsaah'
  if (m.policeTitres === 'Cambria') m.policeTitres = 'Utsaah'
  if (m.couleurTitres === '1F3864') m.couleurTitres = '6AAFAB'
  if (m.couleurEnteteCabinet === '1F3864') m.couleurEnteteCabinet = '6AAFAB'
  if (m.couleurEnteteTableau === 'D9E2F3') m.couleurEnteteTableau = 'E5F5F4'
  if (m.couleurBordureTableau === 'BFBFBF') m.couleurBordureTableau = 'AFDAD7'
  return m
}

const ALIGNEMENTS = [
  { value: 'gauche', label: 'Gauche' },
  { value: 'centre', label: 'Centre' },
  { value: 'droite', label: 'Droite' },
]

// ─── Composants utilitaires ───────────────────────────────────────────────────

function ColorField({
  label,
  hex,
  onChange,
}: {
  label: string
  hex: string
  onChange: (val: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={`#${hex}`}
        onChange={(e) => onChange(e.target.value.slice(1).toUpperCase())}
        className="w-10 h-10 rounded border border-gray-200 cursor-pointer p-0.5"
      />
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400 font-mono">#{hex}</p>
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (val: number) => void
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {unit && <span className="text-sm text-gray-500">{unit}</span>}
      </div>
    </div>
  )
}

function LignesEditor({
  label,
  lignes,
  onChange,
  placeholder,
}: {
  label: string
  lignes: string[]
  onChange: (lignes: string[]) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {lignes.map((ligne, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={ligne}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...lignes]
              next[i] = e.target.value
              onChange(next)
            }}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => onChange(lignes.filter((_, j) => j !== i))}
            className="text-gray-300 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...lignes, ''])}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
        <Plus size={12} /> Ajouter une ligne
      </button>
    </div>
  )
}

// ─── Aperçu du document ───────────────────────────────────────────────────────

// Simule une page A4 (794px à 96dpi) mise à l'échelle dans le conteneur aperçu
const DOC_WIDTH = 794
const CM = 37.8 // 1 cm en pixels à 96dpi

function TemplatePreview({ form }: { form: TemplateFormData }) {
  const titleColor = `#${form.couleurTitres}`
  const bodyColor = `#${form.couleurCorps}`
  const headerColor = `#${form.couleurEnteteCabinet}`
  const tableHeaderBg = `#${form.couleurEnteteTableau}`
  const tableBorder = `#${form.couleurBordureTableau}`

  const mL = form.margeGaucheCm * CM
  const mR = form.margeDroiteCm * CM
  const mT = form.margeHautCm * CM

  const logoWidthPx = form.logoLargeurCm * CM

  // Alignement texte en-tête et pied de page
  const textAlign = (a: string): React.CSSProperties['textAlign'] =>
    a === 'droite' ? 'right' : a === 'centre' ? 'center' : 'left'

  // Logo à gauche ou à droite selon l'alignement en-tête
  const headerReversed = form.enteteAlignement === 'droite'

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Aperçu du document</p>
      {/* Conteneur grisé simulant la page dans un environnement */}
      <div className="bg-gray-100 rounded-xl p-4 overflow-hidden border border-gray-200">
        {/* Zone de mise à l'échelle */}
        <div
          className="relative overflow-hidden rounded-sm shadow-xl"
          style={{ height: 500 }}
        >
          <div
            style={{
              width: DOC_WIDTH,
              background: 'white',
              transformOrigin: 'top left',
              transform: `scale(${440 / DOC_WIDTH})`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            {/* ── En-tête ── */}
            <div
              style={{
                padding: `${mT}px ${mR}px 14px ${mL}px`,
                borderBottom: `3px solid ${headerColor}`,
                display: 'flex',
                flexDirection: headerReversed ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 20,
              }}
            >
              {form.logoBase64 && (
                <img
                  src={form.logoBase64}
                  alt="Logo"
                  style={{ width: logoWidthPx, objectFit: 'contain', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, textAlign: textAlign(form.enteteAlignement), fontFamily: form.policeTitres, color: headerColor, lineHeight: 1.3 }}>
                {form.enteteTexteLignes.map((l, i) => (
                  <div key={i} style={{ fontSize: i === 0 ? 14 : 11, fontWeight: i === 0 ? 700 : 400 }}>{l || '…'}</div>
                ))}
              </div>
            </div>

            {/* ── Titre centré ── */}
            <div style={{ padding: `24px ${mR}px 16px ${mL}px`, textAlign: 'center' }}>
              <div style={{ fontFamily: form.policeTitres, fontSize: form.taillePoliceTitre1, color: titleColor, fontWeight: 'bold', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Procès-verbal de réunion
              </div>
              <div style={{ fontFamily: form.policeTitres, fontSize: form.taillePoliceTitre2, color: titleColor, marginTop: 6 }}>
                Société Exemple SAS — 15 janvier 2025
              </div>
            </div>

            {/* ── Corps ── */}
            <div style={{ padding: `0 ${mR}px 16px ${mL}px` }}>
              <p style={{ fontFamily: form.policeCorps, fontSize: form.taillePoliceCorps, color: bodyColor, lineHeight: form.interligne, textAlign: form.justifierCorps ? 'justify' : 'left', margin: 0 }}>
                La réunion s&apos;est tenue le 15 janvier 2025 à 10h00 par visioconférence. Étaient présents les représentants de la société, l&apos;administrateur judiciaire et les membres du cabinet BL &amp; Associés, ainsi que les représentants des établissements bancaires partenaires.
              </p>
            </div>

            {/* ── Tableau ── */}
            <div style={{ padding: `0 ${mR}px 16px ${mL}px` }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: tableHeaderBg }}>
                    {['Action', 'Responsable', 'Échéance'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', border: `1px solid ${tableBorder}`, fontFamily: form.policeTitres, color: titleColor, fontSize: form.taillePoliceTitre2 - 1, textAlign: 'left', fontWeight: 600 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {['Rédiger le rapport financier', 'J. Dupont (Cabinet)', '01/02/2025'].map((v, i) => (
                      <td key={i} style={{ padding: '8px 10px', border: `1px solid ${tableBorder}`, fontFamily: form.policeCorps, color: bodyColor, fontSize: form.taillePoliceCorps }}>
                        {v}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Pied de page ── */}
            <div style={{ padding: `10px ${mR}px`, borderTop: '1px solid #e5e7eb', textAlign: textAlign(form.piedPageAlignement), fontFamily: form.policeCorps, color: `${bodyColor}99`, fontSize: form.taillePoliceCorps - 1 }}>
              {form.piedPageLignes.map((l, i) => <div key={i}>{l || '…'}</div>)}
              {form.numeroterPages && (
                <div>{form.formatNumerotation.replace('{n}', '1').replace('{total}', '3')}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

interface Props {
  initial?: Partial<TemplateFormData>
  onSaved: () => void
  onCancel: () => void
}

export function TemplateEditor({ initial, onSaved, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('general')
  const [form, setForm] = useState<TemplateFormData>({ ...DEFAULT_FORM, ...applyLegacyMigration(initial ?? {}) })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof TemplateFormData>(key: K, value: TemplateFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) { toast.error('Image trop lourde (max 500 Ko)'); return }
    const reader = new FileReader()
    reader.onload = () => set('logoBase64', reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nom du template requis'); return }
    setSaving(true)
    const url = form.id ? `/api/templates/${form.id}` : '/api/templates'
    const method = form.id ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (!res.ok) { toast.error('Erreur lors de la sauvegarde'); return }
    toast.success('Template sauvegardé')
    onSaved()
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_480px] gap-6 xl:items-start">
      {/* ── Formulaire ── */}
      <div className="flex flex-col gap-4 min-h-[520px]">
        {/* Onglets */}
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Contenu onglet — flex-1 pour pousser les boutons en bas */}
        <div className="flex-1">

        {/* ── Général ── */}
        {tab === 'general' && (
          <div className="space-y-5">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700" htmlFor="tpl-name">
                Nom du template
              </label>
              <input
                id="tpl-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="ex. Procédure de conciliation"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => set('isDefault', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Template par défaut (appliqué automatiquement)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Template actif</span>
            </label>
          </div>
        )}

        {/* ── En-tête & Pied de page ── */}
        {tab === 'entete' && (
          <div className="space-y-6">
            {/* Logo */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Logo du cabinet</p>
              {form.logoBase64 ? (
                <div className="flex items-center gap-4">
                  <img
                    src={form.logoBase64}
                    alt="Logo"
                    className="h-12 object-contain border border-gray-200 rounded p-1"
                  />
                  <button
                    type="button"
                    onClick={() => set('logoBase64', null)}
                    className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700"
                  >
                    <X size={14} /> Supprimer
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                >
                  <Upload size={16} /> Choisir un fichier (PNG, JPG — max 500 Ko)
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <NumberField
                label="Largeur du logo dans le document"
                value={form.logoLargeurCm}
                min={1}
                max={10}
                step={0.5}
                unit="cm"
                onChange={(v) => set('logoLargeurCm', v)}
              />
            </div>

            <hr className="border-gray-100" />

            {/* En-tête */}
            <LignesEditor
              label="Lignes d'en-tête"
              lignes={form.enteteTexteLignes}
              onChange={(l) => set('enteteTexteLignes', l)}
              placeholder="ex. SELAS BL & Associés"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Alignement de l&apos;en-tête</p>
              <div className="flex gap-3">
                {ALIGNEMENTS.map((a) => (
                  <label key={a.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="entete-align"
                      value={a.value}
                      checked={form.enteteAlignement === a.value}
                      onChange={() => set('enteteAlignement', a.value)}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* Pied de page */}
            <LignesEditor
              label="Lignes de pied de page"
              lignes={form.piedPageLignes}
              onChange={(l) => set('piedPageLignes', l)}
              placeholder="ex. Confidentiel"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">Alignement du pied de page</p>
              <div className="flex gap-3">
                {ALIGNEMENTS.map((a) => (
                  <label key={a.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="pied-align"
                      value={a.value}
                      checked={form.piedPageAlignement === a.value}
                      onChange={() => set('piedPageAlignement', a.value)}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.numeroterPages}
                onChange={(e) => set('numeroterPages', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Numéroter les pages</span>
            </label>
            {form.numeroterPages && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Format de numérotation</label>
                <input
                  type="text"
                  value={form.formatNumerotation}
                  onChange={(e) => set('formatNumerotation', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Page {n} sur {total}"
                />
                <p className="text-xs text-gray-400">Utilisez {'{n}'} pour le numéro et {'{total}'} pour le total</p>
              </div>
            )}
          </div>
        )}

        {/* ── Typographie ── */}
        {tab === 'typographie' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Police du corps</label>
                <select
                  value={form.policeCorps}
                  onChange={(e) => set('policeCorps', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <NumberField
                label="Taille (corps)"
                value={form.taillePoliceCorps}
                min={8}
                max={14}
                unit="pt"
                onChange={(v) => set('taillePoliceCorps', v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Police des titres</label>
                <select
                  value={form.policeTitres}
                  onChange={(e) => set('policeTitres', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Titre 1"
                  value={form.taillePoliceTitre1}
                  min={10}
                  max={20}
                  unit="pt"
                  onChange={(v) => set('taillePoliceTitre1', v)}
                />
                <NumberField
                  label="Titre 2"
                  value={form.taillePoliceTitre2}
                  min={10}
                  max={18}
                  unit="pt"
                  onChange={(v) => set('taillePoliceTitre2', v)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Couleurs ── */}
        {tab === 'couleurs' && (
          <div className="space-y-4">
            <ColorField label="Couleur des titres" hex={form.couleurTitres} onChange={(v) => set('couleurTitres', v)} />
            <ColorField label="Couleur du texte courant" hex={form.couleurCorps} onChange={(v) => set('couleurCorps', v)} />
            <ColorField label="En-tête cabinet (bandeau)" hex={form.couleurEnteteCabinet} onChange={(v) => set('couleurEnteteCabinet', v)} />
            <ColorField label="En-tête des tableaux" hex={form.couleurEnteteTableau} onChange={(v) => set('couleurEnteteTableau', v)} />
            <ColorField label="Bordures des tableaux" hex={form.couleurBordureTableau} onChange={(v) => set('couleurBordureTableau', v)} />
          </div>
        )}

        {/* ── Mise en page ── */}
        {tab === 'mise_en_page' && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">Marges</p>
              <div className="grid grid-cols-2 gap-4">
                <NumberField label="Haut" value={form.margeHautCm} min={1} max={5} step={0.5} unit="cm" onChange={(v) => set('margeHautCm', v)} />
                <NumberField label="Bas" value={form.margeBasCm} min={1} max={5} step={0.5} unit="cm" onChange={(v) => set('margeBasCm', v)} />
                <NumberField label="Gauche" value={form.margeGaucheCm} min={1} max={5} step={0.5} unit="cm" onChange={(v) => set('margeGaucheCm', v)} />
                <NumberField label="Droite" value={form.margeDroiteCm} min={1} max={5} step={0.5} unit="cm" onChange={(v) => set('margeDroiteCm', v)} />
              </div>
            </div>
            <NumberField
              label="Interligne"
              value={form.interligne}
              min={1}
              max={2}
              step={0.05}
              onChange={(v) => set('interligne', v)}
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.justifierCorps}
                onChange={(e) => set('justifierCorps', e.target.checked)}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Justifier le texte courant</span>
            </label>
          </div>
        )}

        </div>{/* fin flex-1 */}

        {/* Boutons — toujours en bas grâce au flex-col + mt-auto */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-auto">
          <Button variant="outline" onClick={onCancel}>Annuler</Button>
          <Button onClick={handleSave} loading={saving}>Enregistrer</Button>
        </div>
      </div>

      {/* ── Aperçu (colonne droite) ── */}
      <div className="sticky top-4">
        <TemplatePreview form={form} />
      </div>
    </div>
  )
}
