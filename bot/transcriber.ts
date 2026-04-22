/**
 * transcriber.ts — Transcription audio via OpenAI Whisper
 *
 * Envoie un fichier audio .wav à l'API Whisper et retourne le texte transcrit.
 * Le fichier doit être en 16 kHz mono (produit par ffmpeg dans browser-bot.ts).
 * Utilise le FormData et Blob natifs de Node.js 18+ (pas de dépendance npm externe).
 */

import * as fs from 'fs'

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // Whisper API limit: 25 MB

export async function transcribeAudio(audioFilePath: string): Promise<string | null> {
  try {
    const stat = fs.statSync(audioFilePath)
    if (stat.size === 0) {
      console.warn('[transcriber] Fichier audio vide — aucune transcription')
      return null
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.warn(`[transcriber] Fichier trop volumineux (${Math.round(stat.size / 1024 / 1024)} MB > 25 MB)`)
      return null
    }

    // Use native Node.js 18+ FormData + Blob (no npm package needed)
    const fileBuffer = fs.readFileSync(audioFilePath)
    const blob = new Blob([fileBuffer], { type: 'audio/wav' })

    const form = new FormData()
    form.append('file', blob, 'audio.wav')
    form.append('model', 'whisper-1')
    form.append('language', 'fr')
    form.append('response_format', 'text')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    })

    if (!res.ok) {
      const error = await res.text()
      console.error('[transcriber] Erreur Whisper API:', error)
      return null
    }

    const text = await res.text()
    return text.trim() || null
  } catch (err) {
    console.error('[transcriber] Erreur transcription:', err)
    return null
  }
}
