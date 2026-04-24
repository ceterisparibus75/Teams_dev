import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy', { locale: fr })
}

export function formatDateTime(date: Date | string): string {
  return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: fr })
}

/**
 * Extrait la durée réelle d'une réunion depuis un fichier VTT Teams.
 * Lit le dernier timestamp de fin pour obtenir la durée effective de l'enregistrement.
 * Retourne null si le VTT ne contient pas de timestamps valides.
 */
export function extractVttDurationMinutes(vtt: string): number | null {
  // Regex sur les timestamps de fin : "HH:MM:SS.mmm" après " --> "
  const regex = /-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.\d{3}/g
  let lastH = 0, lastM = 0, lastS = 0
  let found = false
  let match: RegExpExecArray | null
  while ((match = regex.exec(vtt)) !== null) {
    lastH = match[1] ? parseInt(match[1]) : 0
    lastM = parseInt(match[2])
    lastS = parseInt(match[3])
    found = true
  }
  if (!found) return null
  const totalSeconds = lastH * 3600 + lastM * 60 + lastS
  return totalSeconds > 0 ? Math.max(1, Math.round(totalSeconds / 60)) : null
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[îï]/g, 'i')
    .replace(/[ôö]/g, 'o')
    .replace(/[ùûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
