export interface TemplateSection {
  id: string
  label: string
  type: 'text' | 'list' | 'table'
  aiGenerated: boolean
}

export interface PVSection {
  numero: number
  titre: string
  contenu: string
}

export interface MinutesContent {
  summary: string
  actions: Array<{ description: string; responsable: string; echeance: string }>
  notes: string
  sections?: PVSection[]
  prochaine_reunion?: string
  [key: string]: unknown
}

export interface GraphMeeting {
  id: string
  subject: string
  startDateTime: string
  endDateTime: string
  organizer: { emailAddress: { name: string; address: string } }
  attendees: Array<{ emailAddress: { name: string; address: string } }>
  joinUrl?: string | null
}

export interface MeetingAttendanceRecord {
  name: string
  email?: string
  totalAttendanceInSeconds?: number
  intervals: Array<{ joinDateTime?: string; leaveDateTime?: string }>
}

export type MeetingAttendanceStatus =
  | 'not_requested'
  | 'found'
  | 'missing_scope'
  | 'meeting_not_found'
  | 'report_not_found'
  | 'records_empty'
  | 'error'

export interface MeetingAttendanceLookup {
  status: MeetingAttendanceStatus
  records: MeetingAttendanceRecord[]
  detail?: string
}
