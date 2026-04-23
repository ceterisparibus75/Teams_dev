import {
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  WidthType,
  UnderlineType,
  PageBreak,
  ShadingType,
  LineRuleType,
  convertMillimetersToTwip,
  type ITableBordersOptions,
} from 'docx'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import fs from 'fs'
import path from 'path'
import { slugify } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'
import type { PvContent } from '@/schemas/pv-content.schema'

// ─── TemplateConfig ───────────────────────────────────────────────────────────

export interface TemplateConfig {
  logoBase64?: string | null
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

const DEFAULT_TEMPLATE: TemplateConfig = {
  logoBase64: null,
  logoLargeurCm: 6,
  enteteTexteLignes: [],
  enteteAlignement: 'droite',
  piedPageLignes: [],
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

// ─── Catégories de participants ───────────────────────────────────────────────

const CATEGORIE_ORDER = [
  'mandataire_ad_hoc', 'conciliateur', 'administrateur_judiciaire', 'mandataire_judiciaire',
  'debiteur', 'conseil_debiteur', 'partenaire_bancaire', 'conseil_partenaire',
  'auditeur_expert', 'actionnaire', 'repreneur', 'autre',
]

const CATEGORIE_LABELS: Record<string, string> = {
  mandataire_ad_hoc: 'Mandataire ad hoc',
  conciliateur: 'Conciliateur',
  administrateur_judiciaire: 'Administrateur judiciaire',
  mandataire_judiciaire: 'Mandataire judiciaire',
  debiteur: 'Entreprise',
  conseil_debiteur: "Conseil de l'entreprise",
  partenaire_bancaire: 'Partenaires bancaires',
  conseil_partenaire: 'Conseil des partenaires bancaires',
  auditeur_expert: 'Auditeurs et experts',
  actionnaire: 'Actionnaires',
  repreneur: 'Repreneurs potentiels',
  autre: 'Autres participants',
}

type Participant = { name: string; email: string; company?: string | null }

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function hp(pt: number) { return pt * 2 }  // half-points pour docx
function cm2twip(cm: number) { return convertMillimetersToTwip(Math.round(cm * 10)) }
function ls(ratio: number) { return Math.round(ratio * 240) }  // line spacing

function alignmentFor(val: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (val === 'gauche') return AlignmentType.LEFT
  if (val === 'centre') return AlignmentType.CENTER
  return AlignmentType.RIGHT
}

function gridBorders(colorHex: string): ITableBordersOptions {
  return {
    top:             { style: BorderStyle.SINGLE, size: 4, color: colorHex },
    bottom:          { style: BorderStyle.SINGLE, size: 4, color: colorHex },
    left:            { style: BorderStyle.SINGLE, size: 4, color: colorHex },
    right:           { style: BorderStyle.SINGLE, size: 4, color: colorHex },
    insideHorizontal:{ style: BorderStyle.SINGLE, size: 2, color: colorHex },
    insideVertical:  { style: BorderStyle.SINGLE, size: 2, color: colorHex },
  }
}

function empty(space = 120): Paragraph {
  return new Paragraph({ text: '', spacing: { after: space } })
}

// ─── Cellules de tableau ──────────────────────────────────────────────────────

function headerCell(text: string, cfg: TemplateConfig): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 20, color: cfg.couleurTitres, font: cfg.policeTitres })],
      spacing: { before: 60, after: 60 },
    })],
    shading: { type: ShadingType.SOLID, fill: cfg.couleurEnteteTableau },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

function dataCell(text: string, cfg: TemplateConfig): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, size: 20, font: cfg.policeCorps, color: cfg.couleurCorps })],
      spacing: { before: 60, after: 60 },
    })],
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

// ─── En-tête du document ──────────────────────────────────────────────────────

function buildHeader(cfg: TemplateConfig, logoBuffer: Buffer | null): Header {
  const children: (Paragraph | Table)[] = []

  // Logo depuis base64 ou fichier public/bl-logo.png par défaut
  const imageBuffer = logoBuffer ?? (() => {
    const p = path.join(process.cwd(), 'public', 'bl-logo.png')
    return fs.existsSync(p) ? fs.readFileSync(p) : null
  })()

  const logoWidthPx = Math.round(cfg.logoLargeurCm * 37.795)
  const logoHeightPx = Math.round(logoWidthPx * 100 / 226)  // ratio logo BL & Associés

  if (imageBuffer && cfg.enteteTexteLignes.length === 0) {
    // Logo seul, centré
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        data: imageBuffer,
        transformation: { width: logoWidthPx, height: logoHeightPx },
        type: 'png',
      })],
      spacing: { after: 0 },
    }))
  } else if (imageBuffer && cfg.enteteTexteLignes.length > 0) {
    // Logo à gauche, texte à droite via tableau invisible
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...noBorders, insideHorizontal: noBorder, insideVertical: noBorder },
      rows: [new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new ImageRun({ data: imageBuffer, transformation: { width: logoWidthPx, height: logoHeightPx }, type: 'png' })],
            })],
            borders: noBorders,
            width: { size: 40, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: cfg.enteteTexteLignes.map((line, i) => new Paragraph({
              alignment: alignmentFor(cfg.enteteAlignement),
              children: [new TextRun({ text: line, size: i === 0 ? 20 : 16, color: cfg.couleurEnteteCabinet, bold: i === 0 })],
              spacing: { after: 40 },
            })),
            borders: noBorders,
            width: { size: 60, type: WidthType.PERCENTAGE },
          }),
        ],
      })],
    }))
  } else if (cfg.enteteTexteLignes.length > 0) {
    // Texte seul
    cfg.enteteTexteLignes.forEach((line) => {
      children.push(new Paragraph({
        alignment: alignmentFor(cfg.enteteAlignement),
        children: [new TextRun({ text: line, size: 18, color: cfg.couleurEnteteCabinet })],
        spacing: { after: 40 },
      }))
    })
  } else {
    // Fallback : logo par défaut ou nom du cabinet
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: imageBuffer
        ? [new ImageRun({ data: imageBuffer, transformation: { width: logoWidthPx, height: logoHeightPx }, type: 'png' })]
        : [new TextRun({ text: 'SELAS BL & ASSOCIÉS', bold: true, size: 28 })],
      spacing: { after: 0 },
    }))
  }

  return new Header({ children })
}

// ─── Pied de page ─────────────────────────────────────────────────────────────

function buildFooter(cfg: TemplateConfig): Footer {
  const children: Paragraph[] = []
  const align = alignmentFor(cfg.piedPageAlignement)

  cfg.piedPageLignes.forEach((line) => {
    children.push(new Paragraph({
      alignment: align,
      children: [new TextRun({ text: line, size: 16, color: '888888' })],
      spacing: { after: 40 },
    }))
  })

  if (cfg.numeroterPages) {
    const parts = cfg.formatNumerotation.split('{n}')
    const before = parts[0] ?? 'Page '
    const afterParts = (parts[1] ?? '').split('{total}')
    const sep = afterParts[0] ?? ' sur '
    const after = afterParts[1] ?? ''

    children.push(new Paragraph({
      alignment: align,
      children: [
        new TextRun({ text: before, size: 16, color: '888888' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' }),
        new TextRun({ text: sep, size: 16, color: '888888' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '888888' }),
        ...(after ? [new TextRun({ text: after, size: 16, color: '888888' })] : []),
      ],
    }))
  }

  return new Footer({ children })
}

// ─── Tableau des participants (simple, mode legacy) ────────────────────────────

function participantsTableSimple(participants: Participant[], cfg: TemplateConfig): Table {
  const borders = gridBorders(cfg.couleurBordureTableau)
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Nom', cfg),
      headerCell('Société', cfg),
      headerCell('Email', cfg),
      headerCell('Présence', cfg),
    ],
  })
  const dataRows = participants.map((p) => new TableRow({ children: [
    dataCell(p.name, cfg),
    dataCell(p.company ?? '—', cfg),
    dataCell(p.email, cfg),
    dataCell('Visioconférence', cfg),
  ]}))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: [headerRow, ...dataRows] })
}

// ─── Tableau des participants groupés par catégorie ────────────────────────────

function participantsTableGrouped(pvParticipants: PvContent['participants'], cfg: TemplateConfig): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = []

  const presents = pvParticipants.filter((p) => p.presence !== 'Absent')
  const absents  = pvParticipants.filter((p) => p.presence === 'Absent')

  const borders = gridBorders(cfg.couleurBordureTableau)

  // ── Participants présents groupés par catégorie ─────────────────────────────
  const grouped = new Map<string, PvContent['participants']>()
  for (const cat of CATEGORIE_ORDER) {
    const members = presents.filter((p) => p.categorie === cat)
    if (members.length > 0) grouped.set(cat, members)
  }

  for (const [cat, members] of grouped) {
    result.push(new Paragraph({
      children: [new TextRun({
        text: CATEGORIE_LABELS[cat] ?? cat,
        bold: true,
        size: hp(cfg.taillePoliceTitre2),
        color: cfg.couleurTitres,
        font: cfg.policeTitres,
      })],
      spacing: { before: 160, after: 80 },
    }))

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('Nom et prénom', cfg),
        headerCell('Société / Qualité', cfg),
        headerCell('Présence', cfg),
      ],
    })
    const dataRows = members.map((p) => new TableRow({ children: [
      dataCell(p.civilite_nom, cfg),
      dataCell(p.societe_qualite, cfg),
      dataCell(p.presence, cfg),
    ]}))
    result.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [3500, 4500, 2000],
      borders,
      rows: [headerRow, ...dataRows],
    }))
    result.push(empty(80))
  }

  // ── Participants absents ────────────────────────────────────────────────────
  if (absents.length > 0) {
    result.push(empty(80))
    result.push(sectionLabel('Absents excusés', cfg))
    result.push(empty(40))
    const absentHeader = new TableRow({
      tableHeader: true,
      children: [
        headerCell('Nom et prénom', cfg),
        headerCell('Société / Qualité', cfg),
      ],
    })
    const absentRows = absents.map((p) => new TableRow({ children: [
      dataCell(p.civilite_nom, cfg),
      dataCell(p.societe_qualite, cfg),
    ]}))
    result.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [4500, 5500],
      borders,
      rows: [absentHeader, ...absentRows],
    }))
    result.push(empty(80))
  }

  return result
}

// ─── Tableau des actions ──────────────────────────────────────────────────────

function actionsTable(actions: MinutesContent['actions'], cfg: TemplateConfig): Table {
  const borders = gridBorders(cfg.couleurBordureTableau)
  const headerRow = new TableRow({
    tableHeader: true,
    children: [headerCell('Action', cfg), headerCell('Responsable', cfg), headerCell('Échéance', cfg)],
  })
  const dataRows = actions.map((a) => new TableRow({ children: [
    dataCell(a.description, cfg), dataCell(a.responsable, cfg), dataCell(a.echeance, cfg),
  ]}))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [5000, 2500, 2500], borders, rows: [headerRow, ...dataRows] })
}

// ─── Helpers de paragraphe ────────────────────────────────────────────────────

function bodyPara(text: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: hp(cfg.taillePoliceCorps), color: cfg.couleurCorps, font: cfg.policeCorps })],
    spacing: { after: 100, line: ls(cfg.interligne), lineRule: LineRuleType.AUTO },
    alignment: cfg.justifierCorps ? AlignmentType.BOTH : AlignmentType.LEFT,
  })
}

function bulletPara(text: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: hp(cfg.taillePoliceCorps), color: cfg.couleurCorps, font: cfg.policeCorps })],
    bullet: { level: 0 },
    spacing: { after: 80, line: ls(cfg.interligne), lineRule: LineRuleType.AUTO },
  })
}

function sectionLabel(label: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: label, underline: { type: UnderlineType.SINGLE }, size: 26, font: cfg.policeTitres, color: cfg.couleurCorps }),
      new TextRun({ text: ' :', size: 26, font: cfg.policeTitres, color: cfg.couleurCorps }),
    ],
    spacing: { before: 200, after: 80 },
  })
}

function pvSectionHeading(numero: number, titre: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${numero}- ${titre}`, bold: true, size: hp(cfg.taillePoliceTitre2), color: cfg.couleurTitres, font: cfg.policeTitres })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: cfg.couleurTitres, space: 4 } },
    spacing: { before: 320, after: 160 },
  })
}

function contentHeading(text: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, underline: { type: UnderlineType.SINGLE }, size: hp(cfg.taillePoliceTitre2), color: cfg.couleurTitres, font: cfg.policeTitres })],
    spacing: { before: 280, after: 100 },
  })
}

function numberedItem(index: number, text: string, cfg: TemplateConfig): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${index}. ${text}`, size: hp(cfg.taillePoliceCorps), font: cfg.policeCorps })],
    indent: { left: 360, hanging: 360 },
    spacing: { after: 80 },
  })
}

function renderPVContent(contenu: string, cfg: TemplateConfig): Paragraph[] {
  const result: Paragraph[] = []
  for (const block of contenu.split('\n\n')) {
    for (const line of block.split('\n')) {
      const stripped = line.trim()
      if (!stripped) continue
      if (stripped.startsWith('- ')) result.push(bulletPara(stripped.slice(2), cfg))
      else result.push(bodyPara(stripped, cfg))
    }
    result.push(empty(40))
  }
  return result
}

// ─── Exports utilitaires ──────────────────────────────────────────────────────

export function buildDocxFilename(subject: string, date: Date): string {
  const dateStr = format(date, 'ddMMyyyy')
  const slug = slugify(subject)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
  return `PV_${dateStr}_${slug}.docx`
}

export function buildActionRows(actions: MinutesContent['actions']): [string, string, string][] {
  return actions.map((a) => [a.description, a.responsable, a.echeance])
}

// ─── Génération principale ────────────────────────────────────────────────────

export async function generateDocx(params: {
  subject: string
  date: Date
  participants: Participant[]
  content: MinutesContent
  sections: TemplateSection[]
  template?: TemplateConfig | null
}): Promise<Buffer> {
  const { subject, date, participants, content, sections } = params
  const cfg: TemplateConfig = { ...DEFAULT_TEMPLATE, ...(params.template ?? {}) }

  // Migration transparente des anciennes valeurs par défaut stockées en BDD
  if (cfg.policeCorps === 'Cambria') cfg.policeCorps = 'Utsaah'
  if (cfg.policeTitres === 'Cambria') cfg.policeTitres = 'Utsaah'
  if (cfg.couleurTitres === '1F3864') cfg.couleurTitres = '6AAFAB'
  if (cfg.couleurEnteteCabinet === '1F3864') cfg.couleurEnteteCabinet = '6AAFAB'
  if (cfg.couleurEnteteTableau === 'D9E2F3') cfg.couleurEnteteTableau = 'E5F5F4'
  if (cfg.couleurBordureTableau === 'BFBFBF') cfg.couleurBordureTableau = 'AFDAD7'

  // Logo depuis base64 du template
  const logoBuffer: Buffer | null = cfg.logoBase64
    ? Buffer.from(cfg.logoBase64.replace(/^data:[^;]+;base64,/, ''), 'base64')
    : null

  const header = buildHeader(cfg, logoBuffer)
  const footer = buildFooter(cfg)

  // ── Bloc titre ────────────────────────────────────────────────────────────
  const pvData = content._pv as PvContent | undefined
  const rawDate = pvData?.metadata.date_reunion ?? ''
  const isPlaceholder = !rawDate || /non précis/i.test(rawDate) || rawDate.trim().length < 3
  const dateLabel = !isPlaceholder
    ? rawDate.toUpperCase()
    : format(date, 'dd MMMM yyyy', { locale: fr }).toUpperCase()

  const tealBorder = { style: BorderStyle.SINGLE, size: 18, color: cfg.couleurTitres }
  const titleBorder = {
    top: { ...tealBorder, space: 1 },
    left: { ...tealBorder, space: 4 },
    bottom: { ...tealBorder, space: 1 },
    right: { ...tealBorder, space: 4 },
  }

  const titleBlock: Paragraph[] = [
    new Paragraph({ text: '', border: titleBorder }),
    new Paragraph({
      children: [new TextRun({ text: `PROCES VERBAL DE REUNION DU ${dateLabel}`, font: cfg.policeTitres, size: 40, bold: true })],
      alignment: AlignmentType.CENTER,
      border: titleBorder,
      spacing: { before: 80, after: 80 },
    }),
    new Paragraph({ text: '', border: titleBorder }),
    empty(300),
  ]

  // ── Affaire ───────────────────────────────────────────────────────────────
  const affaireLabel = pvData
    ? `${pvData.metadata.affaire}${pvData.metadata.type_procedure ? ` — ${pvData.metadata.type_procedure}` : ''}`
    : subject

  const affaireBlock: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({ text: 'Affaire', underline: { type: UnderlineType.SINGLE }, size: 28, font: cfg.policeTitres }),
        new TextRun({ text: ' : ', size: 28 }),
        new TextRun({ text: affaireLabel, bold: true, size: 28, color: cfg.couleurTitres, font: cfg.policeTitres }),
      ],
      spacing: { after: 200 },
    }),
    empty(100),
  ]

  // ── Modalités ─────────────────────────────────────────────────────────────
  const modalitesText = pvData?.modalites ?? 'Réunion par visioconférence'
  const modalitesBlock: Paragraph[] = [
    sectionLabel('Modalités de tenue de la réunion', cfg),
    bulletPara(modalitesText, cfg),
    empty(100),
  ]

  // ── Documents amont ────────────────────────────────────────────────────────
  const docAmontBlock: Paragraph[] = []
  if (pvData?.documents_amont?.length) {
    docAmontBlock.push(sectionLabel('Documents communiqués en amont', cfg))
    pvData.documents_amont.forEach((d) => docAmontBlock.push(bulletPara(d, cfg)))
    docAmontBlock.push(empty(100))
  }

  // ── Personnes présentes ───────────────────────────────────────────────────
  const personnesBlock: (Paragraph | Table)[] = [
    sectionLabel('Personnes présentes', cfg),
    empty(60),
  ]
  if (pvData?.participants?.length) {
    personnesBlock.push(...participantsTableGrouped(pvData.participants, cfg))
  } else if (participants.length > 0) {
    personnesBlock.push(participantsTableSimple(participants, cfg))
  } else {
    personnesBlock.push(bodyPara('Aucun participant enregistré.', cfg))
  }
  personnesBlock.push(empty(200))

  // ── Ordre du jour ─────────────────────────────────────────────────────────
  const pvSections = content.sections?.length ? content.sections : null
  // Supprime le préfixe numérique éventuel que Claude inclut dans le titre (ex: "1- Titre" → "Titre")
  const stripNumPrefix = (s: string) => s.replace(/^\d+[-.\s]+/, '').trim()
  const agendaItems = pvSections ? pvSections.map((s) => stripNumPrefix(s.titre)) : sections.map((s) => s.label)
  const odjBlock: Paragraph[] = [
    sectionLabel('Ordre du jour', cfg),
    ...agendaItems.map((item, i) => numberedItem(i + 1, item, cfg)),
    empty(200),
  ]

  // ── Corps du PV ───────────────────────────────────────────────────────────
  const contentBlocks: (Paragraph | Table)[] = []

  if (pvSections) {
    for (const pvSection of pvSections) {
      contentBlocks.push(pvSectionHeading(pvSection.numero, stripNumPrefix(pvSection.titre), cfg))
      contentBlocks.push(...renderPVContent(pvSection.contenu, cfg))
    }

    // Points de désaccord (si disponibles)
    if (pvData?.points_desaccord?.length) {
      const nextNum = pvSections.length + 1
      contentBlocks.push(pvSectionHeading(nextNum, 'Points de désaccord et points en suspens', cfg))
      pvData.points_desaccord.forEach((p) => contentBlocks.push(bulletPara(p, cfg)))
      contentBlocks.push(empty(120))
    }

    contentBlocks.push(empty(120))
    contentBlocks.push(contentHeading('Actions à suivre', cfg))
    if (!content.actions?.length) {
      contentBlocks.push(bodyPara('Aucune action à suivre.', cfg))
    } else {
      contentBlocks.push(actionsTable(content.actions, cfg))
    }
    contentBlocks.push(empty(80))

    if (content.notes?.trim()) {
      contentBlocks.push(contentHeading('Notes complémentaires', cfg))
      contentBlocks.push(bodyPara(content.notes.trim(), cfg))
      contentBlocks.push(empty(80))
    }
  } else {
    for (const section of sections) {
      contentBlocks.push(contentHeading(section.label, cfg))
      if (section.id === 'summary') {
        contentBlocks.push(bodyPara(content.summary?.trim() || 'Aucun résumé disponible.', cfg))
      } else if (section.id === 'actions') {
        if (!content.actions?.length) contentBlocks.push(bodyPara('Aucune action à suivre.', cfg))
        else contentBlocks.push(actionsTable(content.actions, cfg))
      } else if (section.id === 'notes') {
        const text = content.notes?.trim()
        contentBlocks.push(bodyPara(text || '—', cfg))
      } else {
        const value = content[section.id]
        if (typeof value === 'string' && value.trim()) contentBlocks.push(bodyPara(value, cfg))
      }
      contentBlocks.push(empty(80))
    }
  }

  // ── Points de vigilance (en fin, réservés à l'auteur) ─────────────────────
  if (pvData?.points_vigilance?.length) {
    contentBlocks.push(empty(200))
    contentBlocks.push(new Paragraph({
      children: [new TextRun({ text: '⚠ Points de vigilance — à valider avant diffusion', bold: true, size: hp(cfg.taillePoliceTitre2), color: 'B45309', font: cfg.policeTitres })],
      spacing: { before: 200, after: 100 },
    }))
    pvData.points_vigilance.forEach((p) => contentBlocks.push(bulletPara(p, cfg)))
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  const signataireText = pvData?.metadata.signataire
    ? `Le ${format(date, 'dd MMMM yyyy', { locale: fr })}\t\t\t\t${pvData.metadata.signataire.toUpperCase()}`
    : `Le ${format(date, 'dd MMMM yyyy', { locale: fr })}\t\t\t\t[ADMINISTRATEUR]`
  const villeText = pvData?.metadata.ville_signature ?? 'PARIS'

  const signatureBlock: Paragraph[] = [
    empty(400),
    new Paragraph({ children: [new TextRun({ text: `Fait à ${villeText},`, bold: true, size: hp(cfg.taillePoliceCorps) })] }),
    new Paragraph({ children: [new TextRun({ text: signataireText, bold: true, size: hp(cfg.taillePoliceCorps) })] }),
  ]

  // ── Annexes ───────────────────────────────────────────────────────────────
  const annexesBlock: Paragraph[] = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ children: [new TextRun({ text: 'Annexe 1 : ', bold: true, size: hp(cfg.taillePoliceCorps) })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: 'Annexe 2 : ', bold: true, size: hp(cfg.taillePoliceCorps) })], spacing: { after: 200 } }),
    new Paragraph({ children: [new TextRun({ text: 'Annexe 3 : ', bold: true, size: hp(cfg.taillePoliceCorps) })] }),
  ]

  const doc = new Document({
    sections: [{
      headers: { default: header },
      footers: { default: footer },
      properties: {
        page: {
          margin: {
            top: cm2twip(cfg.margeHautCm),
            bottom: cm2twip(cfg.margeBasCm),
            left: cm2twip(cfg.margeGaucheCm),
            right: cm2twip(cfg.margeDroiteCm),
          },
        },
      },
      children: [
        ...titleBlock,
        ...affaireBlock,
        ...modalitesBlock,
        ...docAmontBlock,
        ...personnesBlock,
        ...odjBlock,
        ...contentBlocks,
        ...signatureBlock,
        ...annexesBlock,
      ],
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
