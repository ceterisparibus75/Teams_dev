import { logger } from '@/lib/logger'

const log = logger.child({ module: 'openai-transcription' })

const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 25 * 1024 * 1024

export interface TranscriptionMediaInput {
  buffer: Buffer
  filename: string
  contentType: string
}

export async function transcribeMedia(input: TranscriptionMediaInput): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    log.warn('OPENAI_API_KEY absent')
    return null
  }

  if (input.buffer.byteLength === 0) {
    log.warn('Fichier vide')
    return null
  }

  if (input.buffer.byteLength > MAX_TRANSCRIPTION_FILE_SIZE_BYTES) {
    log.warn(
      { sizeMb: Math.round(input.buffer.byteLength / 1024 / 1024) },
      'Fichier trop volumineux (> 25 MB)',
    )
    return null
  }

  const form = new FormData()
  const blob = new Blob([new Uint8Array(input.buffer)], { type: input.contentType })
  form.append('file', blob, input.filename)
  form.append('model', 'whisper-1')
  form.append('language', 'fr')
  form.append('response_format', 'text')

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  })

  if (!response.ok) {
    const errorText = await response.text()
    log.error({ errorText }, 'Erreur API Whisper')
    return null
  }

  const text = await response.text()
  return text.trim() || null
}
