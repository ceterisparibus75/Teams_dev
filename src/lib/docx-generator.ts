import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  BorderStyle,
  WidthType,
  Header,
  ImageRun,
  UnderlineType,
  PageBreak,
  ShadingType,
  type ITableBordersOptions,
} from 'docx'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import fs from 'fs'
import path from 'path'
import { slugify } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'

const TEAL = '70989C'
const TEAL_BORDER = { style: BorderStyle.SINGLE, size: 18, color: TEAL }
const GRID_BORDER: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
  left: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
  right: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'D0E4E5' },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D0E4E5' },
}

type Participant = { name: string; email: string; company?: string | null }

export function buildDocxFilename(subject: string, date: Date): string {
  const dateStr = format(date, 'ddMMyyyy')
  const slug = slugify(subject)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
  return `PV_${dateStr}_${slug}.docx`
}

export function buildActionRows(
  actions: MinutesContent['actions']
): [string, string, string][] {
  return actions.map((a) => [a.description, a.responsable, a.echeance])
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function empty(space = 120): Paragraph {
  return new Paragraph({ text: '', spacing: { after: space } })
}

function sectionLabel(label: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: label, underline: { type: UnderlineType.SINGLE }, size: 26 }),
      new TextRun({ text: ' :', size: 26 }),
    ],
    spacing: { before: 200, after: 80 },
  })
}

function contentHeading(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text, bold: true, underline: { type: UnderlineType.SINGLE }, size: 24 }),
    ],
    spacing: { before: 280, after: 100 },
  })
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, size: 22 })], spacing: { after: 100 } })
}

function bulletItem(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    bullet: { level: 0 },
    spacing: { after: 80 },
  })
}

function numberedItem(index: number, text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${index}. ${text}`, size: 22 })],
    indent: { left: 360, hanging: 360 },
    spacing: { after: 80 },
  })
}

function cell(text: string, bold = false, shaded = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold, size: 20 })],
        spacing: { before: 60, after: 60 },
      }),
    ],
    shading: shaded ? { type: ShadingType.SOLID, fill: 'E8F0F1' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20, color: 'FFFFFF' })],
        spacing: { before: 60, after: 60 },
      }),
    ],
    shading: { type: ShadingType.SOLID, fill: TEAL },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  })
}

// ─── Participants table ────────────────────────────────────────────────────────

function participantsTable(participants: Participant[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Nom'),
      headerCell('Société'),
      headerCell('Email'),
      headerCell('Présence'),
    ],
  })

  const dataRows = participants.map(
    (p) =>
      new TableRow({
        children: [
          cell(p.name),
          cell(p.company ?? '—'),
          cell(p.email),
          cell('Visioconférence'),
        ],
      })
  )

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2800, 2200, 3000, 2000],
    borders: GRID_BORDER,
    rows: [headerRow, ...dataRows],
  })
}

// ─── Actions table ─────────────────────────────────────────────────────────────

function actionsTable(actions: MinutesContent['actions']): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [headerCell('Action'), headerCell('Responsable'), headerCell('Échéance')],
  })
  const dataRows = actions.map(
    (a) =>
      new TableRow({
        children: [cell(a.description), cell(a.responsable), cell(a.echeance)],
      })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [5000, 2500, 2500],
    borders: GRID_BORDER,
    rows: [headerRow, ...dataRows],
  })
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateDocx(params: {
  subject: string
  date: Date
  participants: Participant[]
  content: MinutesContent
  sections: TemplateSection[]
  footerHtml?: string | null
}): Promise<Buffer> {
  const { subject, date, participants, content, sections } = params

  // Logo
  const logoPath = path.join(process.cwd(), 'public', 'bl-logo.png')
  const logoData = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null

  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: logoData
          ? [
              new ImageRun({ data: logoData, transformation: { width: 226, height: 100 }, type: 'png' }),
            ]
          : [new TextRun({ text: 'SELAS BL & ASSOCIÉS', bold: true, size: 28 })],
        spacing: { after: 0 },
      }),
    ],
  })

  // ── Title block (Utsaah, teal border) ─────────────────────────────────────
  const dateLabel = format(date, 'dd MMMM yyyy', { locale: fr }).toUpperCase()
  const titleBorder = {
    top: { ...TEAL_BORDER, space: 1 },
    left: { ...TEAL_BORDER, space: 4 },
    bottom: { ...TEAL_BORDER, space: 1 },
    right: { ...TEAL_BORDER, space: 4 },
  }

  const titleBlock = [
    new Paragraph({ text: '', border: titleBorder }),
    new Paragraph({
      children: [
        new TextRun({
          text: `PROCES VERBAL DE REUNION DU ${dateLabel}`,
          font: 'Utsaah',
          size: 40,
          bold: true,
        }),
      ],
      alignment: AlignmentType.CENTER,
      border: titleBorder,
      spacing: { before: 80, after: 80 },
    }),
    new Paragraph({ text: '', border: titleBorder }),
    empty(300),
  ]

  // ── Affaire ───────────────────────────────────────────────────────────────
  const affaireBlock = [
    new Paragraph({
      children: [
        new TextRun({ text: 'Affaire', underline: { type: UnderlineType.SINGLE }, size: 28 }),
        new TextRun({ text: ' : ', size: 28 }),
        new TextRun({ text: subject, bold: true, size: 28 }),
      ],
      spacing: { after: 200 },
    }),
    empty(100),
  ]

  // ── Modalités ─────────────────────────────────────────────────────────────
  const modalitesBlock = [
    sectionLabel('Modalités de tenues de la réunion'),
    bulletItem('Réunion par visioconférence'),
    empty(100),
  ]

  // ── Personnes présentes ───────────────────────────────────────────────────
  const personnesBlock = [
    sectionLabel('Personnes présentes'),
    empty(60),
    participants.length > 0
      ? participantsTable(participants)
      : bodyParagraph('Aucun participant enregistré.'),
    empty(200),
  ]

  // ── Ordre du jour ─────────────────────────────────────────────────────────
  const agendaItems = sections.map((s) => s.label)
  const odjBlock = [
    sectionLabel('Ordre du jour'),
    ...agendaItems.map((item, i) => numberedItem(i + 1, item)),
    empty(200),
  ]

  // ── Content sections ──────────────────────────────────────────────────────
  const contentBlocks: (Paragraph | Table)[] = []

  for (const section of sections) {
    contentBlocks.push(contentHeading(section.label))

    if (section.id === 'summary') {
      const text = content.summary?.trim()
      contentBlocks.push(bodyParagraph(text || 'Aucun résumé disponible.'))
    } else if (section.id === 'decisions') {
      if (!content.decisions?.length) {
        contentBlocks.push(bodyParagraph('Aucune décision enregistrée.'))
      } else {
        content.decisions.forEach((d, i) => contentBlocks.push(numberedItem(i + 1, d)))
      }
    } else if (section.id === 'actions') {
      if (!content.actions?.length) {
        contentBlocks.push(bodyParagraph('Aucune action à suivre.'))
      } else {
        contentBlocks.push(actionsTable(content.actions))
      }
    } else if (section.id === 'notes') {
      const text = content.notes?.trim()
      if (text) contentBlocks.push(bodyParagraph(text))
      else contentBlocks.push(bodyParagraph('—'))
    } else {
      const value = content[section.id]
      if (typeof value === 'string' && value.trim()) contentBlocks.push(bodyParagraph(value))
    }

    contentBlocks.push(empty(80))
  }

  // ── Signature ─────────────────────────────────────────────────────────────
  const signatureBlock = [
    empty(400),
    new Paragraph({
      children: [
        new TextRun({ text: 'Fait à ____________,', bold: true, size: 22 }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Le ${format(date, 'dd MMMM yyyy', { locale: fr })}`, bold: true, size: 22 }),
        new TextRun({ text: '\t\t\t\t\t\t\t\t', size: 22 }),
        new TextRun({ text: '[ADMINISTRATEUR]', bold: true, size: 22 }),
      ],
    }),
  ]

  // ── Annexes (page 2) ──────────────────────────────────────────────────────
  const annexesBlock = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      children: [new TextRun({ text: 'Annexe 1 : ', bold: true, size: 22 })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Annexe 2 : ', bold: true, size: 22 })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Annexe 3 : ', bold: true, size: 22 })],
    }),
  ]

  const doc = new Document({
    sections: [
      {
        headers: { default: header },
        properties: {
          page: {
            margin: { top: 1134, right: 1183, bottom: 1135, left: 1418 },
          },
        },
        children: [
          ...titleBlock,
          ...affaireBlock,
          ...modalitesBlock,
          ...personnesBlock,
          ...odjBlock,
          ...contentBlocks,
          ...signatureBlock,
          ...annexesBlock,
        ],
      },
    ],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
