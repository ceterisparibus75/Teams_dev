import type { PvContent } from '@/schemas/pv-content.schema'
import type { MinutesContent } from '@/types'

export interface MinutesQualityAlert {
  code: 'forbidden_phrase' | 'forbidden_term'
  severity: 'error'
  field: string
  message: string
  excerpt: string
}

interface ScannableField {
  field: string
  text: string
}

const FORBIDDEN_RULES = [
  {
    code: 'forbidden_phrase' as const,
    regex: /\bconseil du débiteur\b/gi,
    message: 'Remplacer "conseil du débiteur" par "conseil de l’entreprise".',
  },
  {
    code: 'forbidden_term' as const,
    regex: /\bdébiteur\b/gi,
    message: 'Remplacer "débiteur" par "entreprise" ou par une désignation métier plus précise.',
  },
]

function buildExcerpt(text: string, start: number, end: number): string {
  const contextBefore = Math.max(0, start - 35)
  const contextAfter = Math.min(text.length, end + 35)
  const prefix = contextBefore > 0 ? '…' : ''
  const suffix = contextAfter < text.length ? '…' : ''
  return `${prefix}${text.slice(contextBefore, contextAfter).trim()}${suffix}`
}

function collectScannableFields(content: MinutesContent): ScannableField[] {
  const fields: ScannableField[] = []
  const addField = (field: string, text?: string | null) => {
    if (typeof text === 'string' && text.trim()) {
      fields.push({ field, text })
    }
  }

  addField('Résumé', content.summary)
  addField('Notes complémentaires', content.notes)
  addField('Prochaine réunion', content.prochaine_reunion)

  content.sections?.forEach((section, index) => {
    addField(`Section ${index + 1} — titre`, section.titre)
    addField(`Section ${index + 1} — contenu`, section.contenu)
  })

  content.actions?.forEach((action, index) => {
    addField(`Action ${index + 1} — description`, action.description)
    addField(`Action ${index + 1} — responsable`, action.responsable)
    addField(`Action ${index + 1} — échéance`, action.echeance)
  })

  const pv = content._pv as PvContent | undefined
  if (!pv) return fields

  pv.participants?.forEach((participant, index) => {
    addField(`PV structuré — participant ${index + 1} — société/qualité`, participant.societe_qualite)
  })

  pv.points_vigilance?.forEach((item, index) => {
    addField(`PV structuré — point de vigilance ${index + 1}`, item)
  })

  return fields
}

export function getMinutesQualityAlerts(content: MinutesContent): MinutesQualityAlert[] {
  const alerts: MinutesQualityAlert[] = []

  for (const field of collectScannableFields(content)) {
    const occupiedRanges: Array<{ start: number; end: number }> = []

    for (const rule of FORBIDDEN_RULES) {
      rule.regex.lastIndex = 0
      let match: RegExpExecArray | null

      while ((match = rule.regex.exec(field.text)) !== null) {
        const start = match.index
        const end = start + match[0].length
        const overlaps = occupiedRanges.some((range) => start < range.end && end > range.start)
        if (overlaps) continue

        alerts.push({
          code: rule.code,
          severity: 'error',
          field: field.field,
          message: rule.message,
          excerpt: buildExcerpt(field.text, start, end),
        })

        occupiedRanges.push({ start, end })
      }
    }
  }

  return alerts
}
