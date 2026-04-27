// Façade Claude — re-exports depuis src/lib/claude/.
// Conserver l'import `@/lib/claude-generator` partout pour la rétrocompatibilité.
// L'implémentation est split par responsabilité (prompts, converters, generator).

export { generateMinutesContent } from './claude/generator'
export type { GenerationStyle } from './claude/generator'

export {
  pvContentToMinutesContent,
  createSkeletonContent,
  parseMinutesContent,
  normalizeParticipantPresenceFromTranscript,
} from './claude/converters'

export { buildPrompt } from './claude/prompts'
