// Récupération des transcriptions Teams avec stratégies de fallback :
// 1. Token délégué + path /me/onlineMeetings (organisateur)
// 2. Token délégué + path /users/{oid}/onlineMeetings
// 3. Token applicatif (app-only)
// 4. Recherche du fichier .vtt dans OneDrive
// 5. Recherche de l'enregistrement .mp4 + Whisper

import { logger } from '@/lib/logger'
import {
  getAccessTokenResult,
  decodeAccessTokenClaims,
  tokenHasTranscriptScope,
  tokenHasFileReadScope,
  getAppOnlyToken,
} from './auth'
import {
  graphGetJson,
  graphGetText,
  escapeODataString,
  getErrorMessage,
  isReauthError,
  isPermissionError,
  isForbiddenDetail,
  mergeDebug,
} from './http'
import {
  parseTranscriptText,
  searchTranscriptFile,
  searchRecordingFile,
  fetchTranscriptWithAppToken,
} from './transcript-parser'

const log = logger.child({ module: 'graph/transcription' })

export type TranscriptionResult =
  | { ok: true; transcription: string }
  | {
      ok: false
      reason:
        | 'missing_join_url'
        | 'missing_connection'
        | 'reauth_required'
        | 'permission_denied'
        | 'policy_denied'
        | 'meeting_not_found'
        | 'transcript_not_found'
        | 'transcript_empty'
        | 'graph_error'
      detail?: string
    }

export interface TranscriptionLookupOptions {
  subject?: string | null
}

export async function getTranscription(
  userId: string,
  joinUrl: string | null | undefined,
  options?: TranscriptionLookupOptions,
): Promise<string | null> {
  const result = await getTranscriptionResult(userId, joinUrl, options)
  return result.ok ? result.transcription : null
}

export async function getTranscriptionResult(
  userId: string,
  joinUrl: string | null | undefined,
  options?: TranscriptionLookupOptions,
): Promise<TranscriptionResult> {
  if (!joinUrl) return { ok: false, reason: 'missing_join_url' }

  const tokenResult = await getAccessTokenResult(userId)
  if (!tokenResult.ok) {
    if (tokenResult.reason === 'missing_connection') {
      return { ok: false, reason: 'missing_connection' }
    }
    if (tokenResult.reason === 'reauth_required') {
      return { ok: false, reason: 'reauth_required', detail: tokenResult.detail }
    }
    return { ok: false, reason: 'graph_error', detail: tokenResult.detail }
  }

  const tokenClaims = decodeAccessTokenClaims(tokenResult.accessToken)
  const tokenOid = tokenClaims?.oid
  const hasTranscriptScope = tokenHasTranscriptScope(tokenResult.accessToken)
  const canSearchFiles = tokenHasFileReadScope(tokenResult.accessToken)

  const tryFileFallback = async (detail: string | undefined): Promise<TranscriptionResult | null> => {
    const subject = options?.subject?.trim()
    if (!subject) return null
    if (!canSearchFiles) {
      return {
        ok: false,
        reason: 'permission_denied',
        detail: mergeDebug(
          `${detail ?? 'Acces transcript refuse.'} | Le token ne contient pas Files.Read ou Files.Read.All pour chercher le fichier de transcription OneDrive/SharePoint.`,
          tokenResult.debug,
        ),
      }
    }

    try {
      const transcriptFile = await searchTranscriptFile(tokenResult.accessToken, subject)
      if (transcriptFile) return { ok: true, transcription: transcriptFile.transcription }

      const recordingFile = await searchRecordingFile(tokenResult.accessToken, subject)
      if (recordingFile) return { ok: true, transcription: recordingFile.transcription }

      return null
    } catch (error) {
      return {
        ok: false,
        reason: isPermissionError(error) ? 'permission_denied' : 'graph_error',
        detail: mergeDebug(
          `${detail ?? 'Acces transcript refuse.'} | Fallback fichier: ${getErrorMessage(error) ?? 'Erreur inconnue'}`,
          tokenResult.debug,
        ),
      }
    }
  }

  const tryAppOnlyTranscriptFallback = async (): Promise<string | null> => {
    if (!tokenOid) return null
    try {
      // resolveOnlineMeetingId est dans transcript-parser pour éviter une boucle d'imports.
      const { resolveOnlineMeetingId } = await import('./transcript-parser')
      const onlineMeetingId = await resolveOnlineMeetingId(tokenResult.accessToken, joinUrl, tokenOid)
      if (!onlineMeetingId) return null
      return await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
    } catch {
      return null
    }
  }

  if (!hasTranscriptScope) {
    const appTranscript = await tryAppOnlyTranscriptFallback()
    if (appTranscript) return { ok: true, transcription: appTranscript }

    const fallbackResult = canSearchFiles
      ? await tryFileFallback(
          mergeDebug(
            'Le token delegue ne contient pas OnlineMeetingTranscript.Read.All.',
            tokenResult.debug,
          ),
        )
      : null
    if (fallbackResult) return fallbackResult

    return {
      ok: false,
      reason: 'permission_denied',
      detail: mergeDebug(
        'Le token delegue ne contient pas OnlineMeetingTranscript.Read.All.',
        tokenResult.debug,
      ),
    }
  }

  try {
    const escapedJoinUrl = escapeODataString(joinUrl)
    const meetingLookup = new URLSearchParams({
      $filter: `JoinWebUrl eq '${escapedJoinUrl}'`,
    })

    let lookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
      tokenResult.accessToken,
      '/me/onlineMeetings',
      meetingLookup,
    )
    let onlineMeetingId = lookup.value?.[0]?.id

    if (!onlineMeetingId && tokenOid) {
      const appToken = await getAppOnlyToken()
      if (appToken) {
        try {
          const appLookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
            appToken,
            `/users/${encodeURIComponent(tokenOid)}/onlineMeetings`,
            meetingLookup,
          )
          onlineMeetingId = appLookup.value?.[0]?.id
          if (onlineMeetingId) {
            const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
            if (appTranscript) return { ok: true, transcription: appTranscript }
            return { ok: false, reason: 'transcript_not_found' }
          }
        } catch {
          // ignore, fall through
        }
      }
    }

    if (!onlineMeetingId) return { ok: false, reason: 'meeting_not_found' }

    const transcriptCandidates = [
      { label: 'me', basePath: `/me/onlineMeetings/${encodeURIComponent(onlineMeetingId)}` },
      ...(tokenOid
        ? [
            {
              label: `users/${tokenOid}`,
              basePath: `/users/${encodeURIComponent(tokenOid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
            },
          ]
        : []),
    ]

    let transcripts: { value?: Array<{ id?: string; createdDateTime?: string }> } | null = null
    let transcriptBasePath: string | null = null
    const transcriptErrors: string[] = []

    for (const candidate of transcriptCandidates) {
      try {
        transcripts = await graphGetJson<{ value?: Array<{ id?: string; createdDateTime?: string }> }>(
          tokenResult.accessToken,
          `${candidate.basePath}/transcripts`,
        )
        transcriptBasePath = candidate.basePath
        break
      } catch (error) {
        transcriptErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    if (!transcripts) {
      const detail = mergeDebug(transcriptErrors.join(' || '), tokenResult.debug)
      if (transcriptErrors.some((entry) => isForbiddenDetail(entry))) {
        if (tokenOid) {
          const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
          if (appTranscript) return { ok: true, transcription: appTranscript }
        }
        const fallbackResult = await tryFileFallback(detail)
        if (fallbackResult) return fallbackResult
        return { ok: false, reason: 'policy_denied', detail }
      }
      return { ok: false, reason: 'graph_error', detail }
    }

    if (!transcripts.value?.length) return { ok: false, reason: 'transcript_not_found' }

    const latestTranscript = [...transcripts.value].sort(
      (a, b) =>
        new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime(),
    )[0]
    const transcriptId = latestTranscript?.id
    if (!transcriptId) return { ok: false, reason: 'transcript_not_found' }

    let content: string | null = null
    const contentErrors: string[] = []

    for (const candidate of transcriptCandidates) {
      if (transcriptBasePath && candidate.basePath !== transcriptBasePath && candidate.label !== 'me') {
        continue
      }
      try {
        content = await graphGetText(
          tokenResult.accessToken,
          `${candidate.basePath}/transcripts/${encodeURIComponent(transcriptId)}/content`,
          new URLSearchParams({ $format: 'text/vtt' }),
        )
        break
      } catch (error) {
        contentErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
      }
    }

    if (!content && transcriptBasePath) {
      for (const candidate of transcriptCandidates) {
        if (`${candidate.basePath}` === transcriptBasePath) continue
        try {
          content = await graphGetText(
            tokenResult.accessToken,
            `${candidate.basePath}/transcripts/${encodeURIComponent(transcriptId)}/content`,
            new URLSearchParams({ $format: 'text/vtt' }),
          )
          break
        } catch (error) {
          contentErrors.push(`${candidate.label}: ${getErrorMessage(error) ?? 'Erreur inconnue'}`)
        }
      }
    }

    if (!content) {
      const detail = mergeDebug(contentErrors.join(' || '), tokenResult.debug)
      if (contentErrors.some((entry) => isForbiddenDetail(entry))) {
        if (tokenOid) {
          const appTranscript = await fetchTranscriptWithAppToken(tokenOid, onlineMeetingId)
          if (appTranscript) return { ok: true, transcription: appTranscript }
        }
        const fallbackResult = await tryFileFallback(detail)
        if (fallbackResult) return fallbackResult
        return { ok: false, reason: 'policy_denied', detail }
      }
      return { ok: false, reason: 'graph_error', detail }
    }

    if (typeof content !== 'string') return { ok: false, reason: 'transcript_empty' }

    const transcription = parseTranscriptText(content)
    if (!transcription) return { ok: false, reason: 'transcript_empty' }

    return { ok: true, transcription }
  } catch (error) {
    log.error({ scope: 'getTranscription', err: error }, 'failed')
    if (isPermissionError(error)) {
      return {
        ok: false,
        reason: 'permission_denied',
        detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
      }
    }
    if (isReauthError(error)) {
      return {
        ok: false,
        reason: 'reauth_required',
        detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
      }
    }
    return {
      ok: false,
      reason: 'graph_error',
      detail: mergeDebug(getErrorMessage(error), tokenResult.debug),
    }
  }
}
