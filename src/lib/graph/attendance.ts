// Rapports de présence Teams (qui était présent, combien de temps).

import { logger } from '@/lib/logger'
import type { MeetingAttendanceLookup, MeetingAttendanceRecord } from '@/types'
import {
  getAccessTokenResult,
  decodeAccessTokenClaims,
  tokenHasAttendanceArtifactScope,
} from './auth'
import { graphGetJson, getErrorMessage, mergeDebug } from './http'
import { resolveOnlineMeetingId } from './transcript-parser'

const log = logger.child({ module: 'graph/attendance' })

interface AttendanceReportRecord {
  id?: string
  meetingStartDateTime?: string
  meetingEndDateTime?: string
}

interface AttendanceRecordResponse {
  emailAddress?: string
  totalAttendanceInSeconds?: number
  identity?: {
    displayName?: string
    user?: { displayName?: string }
    guest?: { displayName?: string }
  }
  attendanceIntervals?: Array<{ joinDateTime?: string; leaveDateTime?: string }>
}

function toAttendanceRecord(record: AttendanceRecordResponse): MeetingAttendanceRecord | null {
  const name =
    record.identity?.displayName ??
    record.identity?.user?.displayName ??
    record.identity?.guest?.displayName ??
    record.emailAddress ??
    ''

  if (!name.trim() && !record.emailAddress?.trim()) return null

  return {
    name: name.trim() || record.emailAddress!.trim(),
    email: record.emailAddress?.trim() || undefined,
    totalAttendanceInSeconds: record.totalAttendanceInSeconds,
    intervals: record.attendanceIntervals ?? [],
  }
}

export async function getAttendanceLookup(
  userId: string,
  joinUrl: string | null | undefined,
): Promise<MeetingAttendanceLookup> {
  if (!joinUrl) return { status: 'error', records: [], detail: 'Lien de réunion manquant.' }

  const tokenResult = await getAccessTokenResult(userId)
  if (!tokenResult.ok) {
    return {
      status: 'error',
      records: [],
      detail: tokenResult.detail ?? tokenResult.reason,
    }
  }
  if (!tokenHasAttendanceArtifactScope(tokenResult.accessToken)) {
    const detail = mergeDebug(
      'Scope OnlineMeetingArtifact.Read.All absent du token utilisateur.',
      tokenResult.debug,
    )
    log.warn({ scope: 'getAttendanceRecords' }, detail)
    return { status: 'missing_scope', records: [], detail }
  }

  try {
    const tokenClaims = decodeAccessTokenClaims(tokenResult.accessToken)
    const onlineMeetingId = await resolveOnlineMeetingId(
      tokenResult.accessToken,
      joinUrl,
      tokenClaims?.oid,
    )
    if (!onlineMeetingId) {
      const detail = mergeDebug('onlineMeeting introuvable via joinUrl.', tokenResult.debug)
      log.warn({ scope: 'getAttendanceRecords' }, detail)
      return { status: 'meeting_not_found', records: [], detail }
    }

    const basePathCandidates = [
      `/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
      ...(tokenClaims?.oid
        ? [`/users/${encodeURIComponent(tokenClaims.oid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`]
        : []),
    ]

    const errors: string[] = []

    for (const basePath of basePathCandidates) {
      try {
        const reports = await graphGetJson<{ value?: AttendanceReportRecord[] }>(
          tokenResult.accessToken,
          `${basePath}/attendanceReports`,
        )
        const latestReport = [...(reports.value ?? [])].sort(
          (a, b) =>
            new Date(b.meetingEndDateTime ?? b.meetingStartDateTime ?? 0).getTime() -
            new Date(a.meetingEndDateTime ?? a.meetingStartDateTime ?? 0).getTime(),
        )[0]

        if (!latestReport?.id) {
          errors.push(`${basePath}: aucun attendanceReport`)
          continue
        }

        const records = await graphGetJson<{ value?: AttendanceRecordResponse[] }>(
          tokenResult.accessToken,
          `${basePath}/attendanceReports/${encodeURIComponent(latestReport.id)}/attendanceRecords`,
        )

        const attendanceRecords = (records.value ?? [])
          .map(toAttendanceRecord)
          .filter((r): r is MeetingAttendanceRecord => Boolean(r))

        if (attendanceRecords.length > 0) {
          return { status: 'found', records: attendanceRecords }
        }
        errors.push(`${basePath}: attendanceRecords vide`)
      } catch (error) {
        errors.push(`${basePath}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    log.warn(
      { scope: 'getAttendanceRecords' },
      `Aucun rapport de présence exploitable. ${mergeDebug(errors.join(' || '), tokenResult.debug)}`,
    )
    const detail = mergeDebug(errors.join(' || '), tokenResult.debug)
    const status = errors.every((entry) => entry.includes('aucun attendanceReport'))
      ? 'report_not_found'
      : errors.every((entry) => entry.includes('attendanceRecords vide'))
        ? 'records_empty'
        : 'error'
    return { status, records: [], detail }
  } catch (error) {
    const detail = getErrorMessage(error) ?? String(error)
    log.warn({ scope: 'getAttendanceRecords' }, `Rapport de présence indisponible: ${detail}`)
    return { status: 'error', records: [], detail }
  }
}

export async function getAttendanceRecords(
  userId: string,
  joinUrl: string | null | undefined,
): Promise<MeetingAttendanceRecord[]> {
  const lookup = await getAttendanceLookup(userId, joinUrl)
  return lookup.records
}
