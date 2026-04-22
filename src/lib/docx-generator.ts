import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType,
} from 'docx'
import { format } from 'date-fns'
import { slugify } from '@/lib/utils'
import type { MinutesContent, TemplateSection } from '@/types'

export function buildDocxFilename(subject: string, date: Date): string {
  const dateStr = format(date, 'ddMMyyyy')
  const slug = slugify(subject)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
  return `CR_${dateStr}_${slug}.docx`
}

export function buildActionRows(
  actions: MinutesContent['actions']
): [string, string, string][] {
  return actions.map((a) => [a.description, a.responsable, a.echeance])
}

function heading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 80 } })
}

function body(text: string): Paragraph {
  return new Paragraph({ text, spacing: { after: 120 } })
}

function actionsTable(actions: MinutesContent['actions']): Table {
  const headerRow = new TableRow({
    children: ['Description', 'Responsable', 'Échéance'].map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { fill: 'E5E7EB' },
        })
    ),
  })
  const dataRows = actions.map(
    (a) =>
      new TableRow({
        children: [a.description, a.responsable, a.echeance].map(
          (text) => new TableCell({ children: [new Paragraph({ text })] })
        ),
      })
  )
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: [headerRow, ...dataRows],
  })
}

export async function generateDocx(params: {
  subject: string
  date: Date
  participants: Array<{ name: string; email: string }>
  content: MinutesContent
  sections: TemplateSection[]
  footerHtml?: string | null
}): Promise<Buffer> {
  const { subject, date, participants, content, sections } = params

  const titleParagraphs = [
    new Paragraph({
      children: [new TextRun({ text: 'SELAS BL & ASSOCIÉS', bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Administrateurs Judiciaires', size: 22, color: '6B7280' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: subject, bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      text: format(date, 'dd/MM/yyyy HH:mm'),
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      text: `Participants : ${participants.map((p) => p.name).join(', ')}`,
      spacing: { after: 400 },
    }),
  ]

  const sectionParagraphs: (Paragraph | Table)[] = []

  for (const section of sections) {
    sectionParagraphs.push(heading(section.label))

    if (section.id === 'summary') {
      sectionParagraphs.push(body(content.summary || '—'))
    } else if (section.id === 'decisions') {
      if (!content.decisions.length) {
        sectionParagraphs.push(body('Aucune décision enregistrée.'))
      } else {
        content.decisions.forEach((d) => sectionParagraphs.push(bullet(d)))
      }
    } else if (section.id === 'actions') {
      if (!content.actions.length) {
        sectionParagraphs.push(body('Aucune action à suivre.'))
      } else {
        sectionParagraphs.push(actionsTable(content.actions))
      }
    } else if (section.id === 'notes') {
      sectionParagraphs.push(body(content.notes || '—'))
    } else {
      const value = content[section.id]
      if (typeof value === 'string') sectionParagraphs.push(body(value))
    }
  }

  const doc = new Document({
    sections: [{ children: [...titleParagraphs, ...sectionParagraphs] }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
