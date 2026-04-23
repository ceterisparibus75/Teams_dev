import type { MeetingAttendanceLookup } from '@/types'

export interface AttendanceWarning {
  message: string
  detail?: string
}

export function getAttendanceWarning(attendance?: MeetingAttendanceLookup): AttendanceWarning | null {
  switch (attendance?.status) {
    case 'found':
    case undefined:
      return null
    case 'missing_scope':
      return {
        message: 'Présence Teams non détectée : le nouveau scope Microsoft est absent de votre session.',
        detail: attendance.detail,
      }
    case 'meeting_not_found':
      return {
        message: 'Présence Teams non détectée : réunion Teams introuvable via le lien de réunion.',
        detail: attendance.detail,
      }
    case 'report_not_found':
      return {
        message: 'Présence Teams non détectée : aucun rapport de présence Teams disponible pour cette réunion.',
        detail: attendance.detail,
      }
    case 'records_empty':
      return {
        message: 'Présence Teams non détectée : rapport trouvé, mais sans enregistrement exploitable.',
        detail: attendance.detail,
      }
    case 'not_requested':
      return {
        message: 'Présence Teams non détectée : rapport de présence non demandé pour cette génération.',
        detail: attendance.detail,
      }
    case 'error':
    default:
      return {
        message: 'Présence Teams non détectée : erreur Microsoft Graph lors de la lecture du rapport.',
        detail: attendance?.detail,
      }
  }
}
