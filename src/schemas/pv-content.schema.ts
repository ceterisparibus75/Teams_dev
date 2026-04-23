import { z } from 'zod'

export const PresenceSchema = z.enum(['Visioconférence', 'Présentiel', 'Téléphonique'])

export const TypeProcedureSchema = z.enum([
  'Mandat ad hoc',
  'Conciliation',
  'Redressement judiciaire',
  'Sauvegarde',
])

export const CategoriePVSchema = z.enum([
  'debiteur',
  'conseil_debiteur',
  'partenaire_bancaire',
  'conseil_partenaire',
  'auditeur_expert',
  'mandataire_judiciaire',
  'administrateur_judiciaire',
  'actionnaire',
  'repreneur',
  'autre',
])

export const ParticipantPVSchema = z.object({
  civilite_nom: z.string().min(1),
  societe_qualite: z.string().min(1),
  email: z.string().email().optional(),
  presence: PresenceSchema,
  categorie: CategoriePVSchema,
})

export const SectionPVSchema = z.object({
  titre: z.string().min(1),
  contenu: z.string().min(1),
})

export const ActionPVSchema = z.object({
  libelle: z.string().min(1),
  responsable: z.string().min(1),
  echeance: z.string().min(1),
})

export const ProchaineReunionSchema = z.object({
  date: z.string(),
  heure: z.string(),
  fuseau: z.string().default('heure Paris'),
})

export const PvContentSchema = z.object({
  metadata: z.object({
    date_reunion: z.string().min(1),
    affaire: z.string().min(1),
    type_procedure: TypeProcedureSchema,
    objet: z.string().optional(),
    ville_signature: z.string().default('PARIS'),
    signataire: z.string().min(1),
  }),
  modalites: z.string().min(1),
  participants: z.array(ParticipantPVSchema).min(1),
  documents_amont: z.array(z.string()).default([]),
  resume: z.string().min(1),
  sections: z.array(SectionPVSchema).min(1),
  points_desaccord: z.array(z.string()).default([]),
  actions: z.array(ActionPVSchema).default([]),
  prochaine_reunion: ProchaineReunionSchema.optional(),
  points_vigilance: z.array(z.string()).default([]),
  precisions_a_apporter: z.array(z.string()).default([]),
})

export type PvContent = z.infer<typeof PvContentSchema>
export type ParticipantPV = z.infer<typeof ParticipantPVSchema>
export type SectionPV = z.infer<typeof SectionPVSchema>
export type ActionPV = z.infer<typeof ActionPVSchema>
