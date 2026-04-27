import { z } from 'zod'

// Couleurs hex sans '#', max 8 chars (RGBA possible).
const HexColor = z.string().regex(/^[0-9A-Fa-f]{3,8}$/, 'couleur hex sans #')

// Limite logo base64 à ~3 MB pour éviter les abus (CLAUDE.md note < 2 MB).
const Base64Image = z.string().max(4_000_000).optional()

const AlignmentSchema = z.enum(['gauche', 'centre', 'droite'])

export const TemplateUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(200),

    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),

    logoBase64: Base64Image.nullable(),
    logoLargeurCm: z.number().min(0.5).max(15).optional(),

    enteteTexteLignes: z.array(z.string().max(500)).max(20).optional(),
    enteteAlignement: AlignmentSchema.optional(),

    piedPageLignes: z.array(z.string().max(500)).max(20).optional(),
    piedPageAlignement: AlignmentSchema.optional(),
    numeroterPages: z.boolean().optional(),
    formatNumerotation: z.string().max(100).optional(),

    policeCorps: z.string().max(50).optional(),
    taillePoliceCorps: z.number().int().min(6).max(72).optional(),
    policeTitres: z.string().max(50).optional(),
    taillePoliceTitre1: z.number().int().min(6).max(72).optional(),
    taillePoliceTitre2: z.number().int().min(6).max(72).optional(),

    couleurTitres: HexColor.optional(),
    couleurCorps: HexColor.optional(),
    couleurEnteteCabinet: HexColor.optional(),
    couleurEnteteTableau: HexColor.optional(),
    couleurBordureTableau: HexColor.optional(),

    margeHautCm: z.number().min(0).max(10).optional(),
    margeBasCm: z.number().min(0).max(10).optional(),
    margeGaucheCm: z.number().min(0).max(10).optional(),
    margeDroiteCm: z.number().min(0).max(10).optional(),

    interligne: z.number().min(0.5).max(3).optional(),
    justifierCorps: z.boolean().optional(),
  })
  .strict()

export type TemplateUpsertInput = z.infer<typeof TemplateUpsertSchema>
