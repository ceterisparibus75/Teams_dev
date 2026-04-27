import { cron } from 'inngest'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { inngest } from '@/inngest/client'

const log = logger.child({ module: 'inngest:purge-edit-logs' })

// Rétention RGPD : 5 ans pour les snapshots de PV (cohérent avec la durée
// légale de conservation des pièces de procédure dans une affaire).
// La table `MinutesEditLog` grossit à chaque édition de PV — sans purge,
// elle prend toute la BD à long terme.
const RETENTION_YEARS = 5
const BATCH_SIZE = 1_000

export const purgeEditLogsJob = inngest.createFunction(
  {
    id: 'purge-edit-logs',
    name: 'Purge MinutesEditLog au-delà de la rétention',
    // Tous les jours à 03:00 UTC (~04:00-05:00 Paris selon DST)
    triggers: [cron('0 3 * * *')],
    retries: 2,
  },
  async ({ step }) => {
    const cutoff = new Date()
    cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS)

    let totalDeleted = 0
    // Suppression par batch pour éviter un lock long sur la table.
    for (let pass = 0; pass < 50; pass++) {
      const deleted: number = await step.run(`purge-batch-${pass}`, async () => {
        // Prisma ne supporte pas LIMIT sur deleteMany — on récupère les ids puis on supprime.
        const ids = await prisma.minutesEditLog.findMany({
          where: { editedAt: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        })
        if (ids.length === 0) return 0
        const result = await prisma.minutesEditLog.deleteMany({
          where: { id: { in: ids.map((r) => r.id) } },
        })
        return result.count
      })

      totalDeleted += deleted
      if (deleted < BATCH_SIZE) break
    }

    log.info({ totalDeleted, cutoff: cutoff.toISOString(), retentionYears: RETENTION_YEARS }, 'Purge terminée')
    return { totalDeleted, cutoff: cutoff.toISOString() }
  },
)
