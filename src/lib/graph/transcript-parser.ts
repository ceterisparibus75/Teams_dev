// Parsing VTT/JSON-lines + recherche de fichiers de transcription / enregistrements
// dans OneDrive/SharePoint. Sert de fallback quand le Graph "transcripts" classique
// échoue (permissions, non-organisateur, etc).

import { transcribeMedia } from '@/lib/openai-transcription'
import { graphGetJson, graphGetText, graphGetBuffer, graphPostJson } from './http'
import { getAppOnlyToken } from './auth'

export interface DriveItemLike {
  id?: string
  name?: string
  size?: number
  webUrl?: string
  parentReference?: { driveId?: string; path?: string }
  file?: { mimeType?: string }
  remoteItem?: {
    id?: string
    name?: string
    size?: number
    webUrl?: string
    parentReference?: { driveId?: string; path?: string }
    file?: { mimeType?: string }
  }
}

// Parse un fichier VTT (ou format JSON-lines Teams) en lignes "[Speaker] text"
export function parseTranscriptText(content: string): string | null {
  const lines: string[] = []

  for (const block of content.split('\n\n')) {
    const jsonLines = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))

    if (jsonLines.length > 0) {
      for (const line of jsonLines) {
        try {
          const entry = JSON.parse(line) as { speakerName?: string; spokenText?: string }
          const speaker = entry.speakerName?.trim()
          const text = entry.spokenText?.trim()
          if (text) lines.push(speaker ? `[${speaker}] ${text}` : text)
        } catch {
          // Ignore malformed JSON lines and continue parsing.
        }
      }
      continue
    }

    const match = block.match(/<v ([^>]+)>([\s\S]+)/)
    if (match) {
      const text = match[2].replace(/<[^>]+>/g, '').trim()
      if (text) lines.push(`[${match[1].trim()}] ${text}`)
    }
  }

  return lines.join('\n') || null
}

function simplifyQueryTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDriveReference(item: DriveItemLike): {
  driveId?: string
  itemId?: string
  name?: string
  size?: number
  mimeType?: string
  webUrl?: string
  path?: string
} {
  const remote = item.remoteItem
  return {
    driveId: remote?.parentReference?.driveId ?? item.parentReference?.driveId,
    itemId: remote?.id ?? item.id,
    name: remote?.name ?? item.name,
    size: remote?.size ?? item.size,
    mimeType: remote?.file?.mimeType ?? item.file?.mimeType,
    webUrl: remote?.webUrl ?? item.webUrl,
    path: remote?.parentReference?.path ?? item.parentReference?.path,
  }
}

function scoreTranscriptCandidate(item: DriveItemLike, subject: string): number {
  const ref = extractDriveReference(item)
  const name = (ref.name ?? '').toLowerCase()
  const path = (ref.path ?? '').toLowerCase()
  const simplifiedSubject = simplifyQueryTerm(subject).toLowerCase()

  let score = 0
  if (name.endsWith('.vtt')) score += 100
  if (name.endsWith('.docx')) score += 20
  if (path.includes('/recordings')) score += 30
  if (simplifiedSubject && name.includes(simplifiedSubject)) score += 40

  const subjectTokens = simplifiedSubject.split(' ').filter((token) => token.length >= 4)
  for (const token of subjectTokens) {
    if (name.includes(token)) score += 8
  }

  return score
}

async function searchDriveItems(
  accessToken: string,
  subject: string,
  fileTypes: string[],
): Promise<DriveItemLike[]> {
  const searchQueries = Array.from(
    new Set(
      [
        simplifyQueryTerm(subject),
        simplifyQueryTerm(subject)
          .split(' ')
          .filter((token) => token.length >= 4)
          .slice(0, 5)
          .join(' '),
      ].filter(Boolean),
    ),
  )

  const items: DriveItemLike[] = []

  for (const queryText of searchQueries) {
    const results = await graphPostJson<{
      value?: Array<{
        hitsContainers?: Array<{ hits?: Array<{ resource?: DriveItemLike }> }>
      }>
    }>(accessToken, '/search/query', {
      requests: [
        {
          entityTypes: ['driveItem'],
          query: {
            queryString: `"${queryText}" AND (${fileTypes.map((type) => `filetype:${type}`).join(' OR ')})`,
          },
          from: 0,
          size: 25,
        },
      ],
    })

    const candidates = (results.value ?? [])
      .flatMap((container) => container.hitsContainers ?? [])
      .flatMap((container) => container.hits ?? [])
      .map((hit) => hit.resource)
      .filter((item): item is DriveItemLike => Boolean(item))
      .filter((item) => {
        const ref = extractDriveReference(item)
        const name = (ref.name ?? '').toLowerCase()
        return fileTypes.some((type) => name.endsWith(`.${type}`))
      })

    items.push(...candidates)
  }

  return items.sort((a, b) => scoreTranscriptCandidate(b, subject) - scoreTranscriptCandidate(a, subject))
}

export async function searchTranscriptFile(
  accessToken: string,
  subject: string,
): Promise<{ transcription: string; detail: string } | null> {
  const candidates = await searchDriveItems(accessToken, subject, ['vtt', 'docx'])

  for (const candidate of candidates) {
    const ref = extractDriveReference(candidate)
    if (!ref.driveId || !ref.itemId || !ref.name?.toLowerCase().endsWith('.vtt')) continue

    const content = await graphGetText(
      accessToken,
      `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}/content`,
    )
    const parsed = parseTranscriptText(content)
    if (parsed) {
      return {
        transcription: parsed,
        detail: `Fallback fichier transcript: ${ref.name}${ref.webUrl ? ` (${ref.webUrl})` : ''}`,
      }
    }
  }

  return null
}

export async function searchRecordingFile(
  accessToken: string,
  subject: string,
): Promise<{ transcription: string; detail: string } | null> {
  const candidates = await searchDriveItems(accessToken, subject, ['mp4'])

  for (const candidate of candidates) {
    const ref = extractDriveReference(candidate)
    const name = ref.name ?? ''
    const size = ref.size ?? 0

    if (!ref.driveId || !ref.itemId || !name.toLowerCase().endsWith('.mp4')) continue
    if (size > 25 * 1024 * 1024) continue

    const buffer = await graphGetBuffer(
      accessToken,
      `/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}/content`,
    )
    const transcription = await transcribeMedia({
      buffer,
      filename: name,
      contentType: ref.mimeType ?? 'video/mp4',
    })
    if (transcription) {
      return {
        transcription,
        detail: `Fallback enregistrement: ${name}${ref.webUrl ? ` (${ref.webUrl})` : ''}`,
      }
    }
  }

  return null
}

// Récupère un transcript via le token applicatif (utile quand le user n'est
// pas organisateur). Retourne le contenu texte parsé ou null.
export async function fetchTranscriptWithAppToken(
  userOid: string,
  onlineMeetingId: string,
): Promise<string | null> {
  const appToken = await getAppOnlyToken()
  if (!appToken) return null

  const basePath = `/users/${encodeURIComponent(userOid)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`

  let transcripts: { value?: Array<{ id?: string; createdDateTime?: string }> }
  try {
    transcripts = await graphGetJson(appToken, `${basePath}/transcripts`)
  } catch {
    return null
  }

  if (!transcripts.value?.length) return null

  const latest = [...transcripts.value].sort(
    (a, b) =>
      new Date(b.createdDateTime ?? 0).getTime() - new Date(a.createdDateTime ?? 0).getTime(),
  )[0]
  if (!latest?.id) return null

  try {
    const content = await graphGetText(
      appToken,
      `${basePath}/transcripts/${encodeURIComponent(latest.id)}/content`,
      new URLSearchParams({ $format: 'text/vtt' }),
    )
    return parseTranscriptText(content)
  } catch {
    return null
  }
}

// Résolution joinUrl → onlineMeeting ID, avec fallback app-only si le user
// n'est pas l'organisateur.
export async function resolveOnlineMeetingId(
  accessToken: string,
  joinUrl: string,
  userOid?: string,
): Promise<string | null> {
  const meetingLookup = new URLSearchParams({
    $filter: `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`,
  })

  const lookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
    accessToken,
    '/me/onlineMeetings',
    meetingLookup,
  )
  const delegatedMeetingId = lookup.value?.[0]?.id
  if (delegatedMeetingId) return delegatedMeetingId

  if (!userOid) return null

  const appToken = await getAppOnlyToken()
  if (!appToken) return null

  try {
    const appLookup = await graphGetJson<{ value?: Array<{ id?: string }> }>(
      appToken,
      `/users/${encodeURIComponent(userOid)}/onlineMeetings`,
      meetingLookup,
    )
    return appLookup.value?.[0]?.id ?? null
  } catch {
    return null
  }
}
