// Façade Microsoft Graph — re-exports depuis src/lib/graph/.
// Conserver l'import `@/lib/microsoft-graph` partout pour la rétrocompatibilité.
// L'implémentation est split par responsabilité (auth, http, calendar, attendance,
// transcription, transcript-parser).

export { getValidAccessToken, getAccessTokenResult } from './graph/auth'
export type { AccessTokenResult, AccessTokenClaims } from './graph/auth'

export { getRecentMeetings, getMeetingsEndedInLastHours } from './graph/calendar'

export { getAttendanceLookup, getAttendanceRecords } from './graph/attendance'

export { getTranscription, getTranscriptionResult } from './graph/transcription'
export type { TranscriptionResult, TranscriptionLookupOptions } from './graph/transcription'
