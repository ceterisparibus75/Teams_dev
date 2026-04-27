import { z } from 'zod'
import type { Prisma } from '@prisma/client'

// Cast typé : remplace les `as unknown as Prisma.InputJsonValue` dispersés.
// L'argument doit déjà être un JSON-safe object (sortie Claude validée Zod,
// ou patch utilisateur passé par validateMinutesPatch).
export function toPrismaJson(value: object): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

const StatusSchema = z.enum(['DRAFT', 'VALIDATED', 'SENT'])

// Validation pragmatique du body PATCH /api/minutes/[id].
// Le contenu reste un objet "ouvert" car deux schémas coexistent en BD
// (PvContent structuré récent + MinutesContent legacy). On verrouille :
//  - la forme : objet plain non-array
//  - le statut : enum strict
//  - la taille : 2 MB max sérialisé (protège la BD)
const MAX_CONTENT_BYTES = 2 * 1024 * 1024

const ContentSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => {
      try {
        return JSON.stringify(value).length <= MAX_CONTENT_BYTES
      } catch {
        return false
      }
    },
    { message: `content > ${MAX_CONTENT_BYTES} bytes` },
  )

export const MinutesPatchSchema = z
  .object({
    content: ContentSchema.optional(),
    status: StatusSchema.optional(),
  })
  .strict()
  .refine((b) => b.content !== undefined || b.status !== undefined, {
    message: 'content ou status requis',
  })

export type MinutesPatchInput = z.infer<typeof MinutesPatchSchema>
