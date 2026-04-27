// Conversions et helpers pour le contenu PV :
//   PvContent (Zod, sortie Claude)  ↔  MinutesContent (UI legacy)
//   - createSkeletonContent : PV "vide" pour l'UI quand pas de transcription
//   - parseMinutesContent   : parser texte legacy (fallback + tests)
//   - normalizeParticipantPresenceFromTranscript : recoupe Teams attendance + transcript

import type { PvContent } from '@/schemas/pv-content.schema'
import type { MeetingAttendanceRecord, MinutesContent, PVSection } from '@/types'

// ─── Helpers de matching nom/email ────────────────────────────────────────────

export function normalizeNameForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nameTokens(value: string): string[] {
  return normalizeNameForMatching(value)
    .split(' ')
    .filter((token) => token.length >= 3)
}

export function namesLikelyMatch(a: string, b: string): boolean {
  const normalizedA = normalizeNameForMatching(a)
  const normalizedB = normalizeNameForMatching(b)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true

  const tokensA = new Set(nameTokens(a))
  const tokensB = nameTokens(b)
  if (tokensA.size === 0 || tokensB.length === 0) return false

  const overlap = tokensB.filter((token) => tokensA.has(token)).length
  return overlap >= Math.min(2, tokensB.length)
}

export function extractTranscriptSpeakers(transcription: string | null): string[] {
  if (!transcription) return []

  const speakers = new Set<string>()
  const regex = /^\s*\[([^\]]+)]/gm
  let match: RegExpExecArray | null
  while ((match = regex.exec(transcription)) !== null) {
    const speaker = match[1]?.trim()
    if (speaker) speakers.add(speaker)
  }
  return [...speakers]
}

function participantAppearsInTranscript(
  participantName: string,
  transcription: string | null,
  speakers: string[],
): boolean {
  if (!transcription) return false
  if (speakers.some((speaker) => namesLikelyMatch(speaker, participantName))) return true

  const normalizedTranscript = normalizeNameForMatching(transcription)
  const normalizedParticipant = normalizeNameForMatching(participantName)
  return normalizedParticipant.length > 0 && normalizedTranscript.includes(normalizedParticipant)
}

function attendanceLikelyMatchesParticipant(
  attendance: MeetingAttendanceRecord,
  participant: PvContent['participants'][number],
): boolean {
  const attendanceEmail = attendance.email?.toLowerCase()
  const participantEmail = participant.email?.toLowerCase()
  if (attendanceEmail && participantEmail && attendanceEmail === participantEmail) return true
  return namesLikelyMatch(attendance.name, participant.civilite_nom)
}

function attendanceShowsPresence(attendance: MeetingAttendanceRecord): boolean {
  return (attendance.totalAttendanceInSeconds ?? 0) > 0 || attendance.intervals.length > 0
}

function transcriptExplicitlyMarksAbsent(participantName: string, transcription: string | null): boolean {
  if (!transcription) return false

  const participantTokens = nameTokens(participantName)
  if (participantTokens.length === 0) return false

  const absenceMarkers = [
    'absent', 'absente', 'absents', 'absentes',
    'excuse', 'excusee', 'excuses', 'excusees',
    'decline', 'declinee', 'declines', 'declinees',
    'ne participe pas', 'ne participera pas',
    'n est pas present', 'n est pas presente',
    'ne sera pas present', 'ne sera pas presente',
  ]

  return transcription
    .split(/\r?\n|[.!?;]/)
    .map(normalizeNameForMatching)
    .some((line) => {
      if (!line || !absenceMarkers.some((marker) => line.includes(marker))) return false
      return participantTokens.every((token) => line.includes(token))
    })
}

export function normalizeParticipantPresenceFromTranscript(
  pv: PvContent,
  transcription: string | null,
  attendanceRecords: MeetingAttendanceRecord[] = [],
): PvContent {
  const speakers = extractTranscriptSpeakers(transcription)
  if (speakers.length === 0 && !transcription) return pv

  return {
    ...pv,
    participants: pv.participants.map((participant) => {
      const attendance = attendanceRecords.find((record) =>
        attendanceLikelyMatchesParticipant(record, participant),
      )
      if (attendance) {
        return {
          ...participant,
          presence: attendanceShowsPresence(attendance) ? ('Visioconférence' as const) : participant.presence,
        }
      }

      if (attendanceRecords.length > 0 && participant.presence !== 'Absent') {
        return { ...participant, presence: 'Absent' as const }
      }

      if (participant.presence === 'Absent') return participant
      if (transcriptExplicitlyMarksAbsent(participant.civilite_nom, transcription)) {
        return { ...participant, presence: 'Absent' as const }
      }
      if (participantAppearsInTranscript(participant.civilite_nom, transcription, speakers)) return participant
      return participant
    }),
  }
}

// ─── PvContent → MinutesContent (legacy UI) ───────────────────────────────────

export function pvContentToMinutesContent(pv: PvContent): MinutesContent {
  const sections: PVSection[] = pv.sections.map((s, i) => ({
    numero: i + 1,
    titre: s.titre,
    contenu: s.contenu,
  }))

  const actions = pv.actions.map((a) => ({
    description: a.libelle,
    responsable: a.responsable,
    echeance: a.echeance,
  }))

  const prochaine_reunion = pv.prochaine_reunion
    ? `${pv.prochaine_reunion.date} à ${pv.prochaine_reunion.heure} (${pv.prochaine_reunion.fuseau ?? 'heure Paris'})`
    : undefined

  const notes = pv.precisions_a_apporter.map((p) => `→ ${p}`).join('\n') || ''

  return {
    summary: pv.resume,
    sections,
    actions,
    notes,
    prochaine_reunion,
    _pv: pv,
  }
}

// ─── Squelette PV sans transcription ──────────────────────────────────────────

export function createSkeletonContent(
  subject: string,
  participants?: Array<{ name: string }>,
  date?: Date,
): MinutesContent {
  const dateStr = (date ?? new Date()).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const pv: PvContent = {
    metadata: {
      date_reunion: dateStr,
      affaire: subject,
      type_procedure: 'Mandat ad hoc',
      objet: 'Réunion',
      ville_signature: 'PARIS',
      signataire: '[Administrateur Judiciaire]',
    },
    modalites: 'Réunion par visioconférence',
    participants: (participants ?? []).map((p) => ({
      civilite_nom: p.name,
      societe_qualite: '[À compléter]',
      presence: 'Visioconférence' as const,
      categorie: 'autre' as const,
    })),
    documents_amont: [],
    resume: '[À compléter — aucune transcription Teams disponible pour cette réunion]',
    sections: [{ titre: 'Points abordés', contenu: '[À compléter]' }],
    points_desaccord: [],
    actions: [],
    points_vigilance: ['Compte rendu généré sans transcription Teams — contenu à remplir manuellement'],
    precisions_a_apporter: [],
  }
  return pvContentToMinutesContent(pv)
}

// ─── Parser texte legacy (fallback + tests) ──────────────────────────────────

const DEFAULT_CONTENT: MinutesContent = { summary: '', actions: [], notes: '' }

export function parseMinutesContent(raw: string): MinutesContent {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)

    const sections: PVSection[] | undefined = Array.isArray(parsed.sections)
      ? parsed.sections.filter(
          (s: unknown): s is PVSection =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as PVSection).numero === 'number' &&
            typeof (s as PVSection).titre === 'string' &&
            typeof (s as PVSection).contenu === 'string',
        )
      : undefined

    const summary =
      typeof parsed.resume === 'string' && parsed.resume.trim()
        ? parsed.resume.trim()
        : typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : sections
            ? sections.map((s) => `${s.numero}- ${s.titre}\n\n${s.contenu}`).join('\n\n')
            : ''

    return {
      summary,
      sections: sections?.length ? sections : undefined,
      prochaine_reunion:
        typeof parsed.prochaine_reunion === 'string' && parsed.prochaine_reunion.trim()
          ? parsed.prochaine_reunion.trim()
          : undefined,
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    }
  } catch {
    return { ...DEFAULT_CONTENT }
  }
}
