import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui'

const PROCEDURE_LABELS: Record<string, string> = {
  MANDAT_AD_HOC:         'Mandat ad hoc',
  CONCILIATION:          'Conciliation',
  REDRESSEMENT_JUDICIAIRE: 'Redressement judiciaire',
  SAUVEGARDE:            'Sauvegarde',
}

const STATUT_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' }> = {
  EN_COURS: { label: 'En cours',  variant: 'warning' },
  CLOS:     { label: 'Clos',      variant: 'success' },
  ARCHIVE:  { label: 'Archivé',   variant: 'default' },
}

export default async function DossiersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const dossiers = await prisma.dossier.findMany({
    orderBy: [{ statut: 'asc' }, { createdAt: 'desc' }],
    include: {
      _count: { select: { meetings: true } },
      meetings: {
        select: { minutes: { select: { id: true, status: true } } },
      },
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dossiers</h1>
        <Link
          href="/dossiers/nouveau"
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Nouveau dossier
        </Link>
      </div>

      {dossiers.length === 0 && (
        <p className="text-sm text-gray-500">Aucun dossier créé pour l&apos;instant.</p>
      )}

      <div className="space-y-3">
        {dossiers.map((d) => {
          const statut = STATUT_CONFIG[d.statut]
          const allMinutes = d.meetings.flatMap((m) => m.minutes).filter((mn): mn is NonNullable<typeof mn> => mn != null)
          const minutesCount = allMinutes.length
          const sentCount = allMinutes.filter((mn) => mn.status === 'SENT').length

          return (
            <Link
              key={d.id}
              href={`/dossiers/${d.id}`}
              className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-400 bg-gray-50 border border-gray-200 rounded px-2 py-0.5">
                    {d.reference}
                  </span>
                  <Badge variant={statut.variant}>{statut.label}</Badge>
                </div>
                <p className="font-medium text-gray-900">{d.denomination}</p>
                <p className="text-xs text-gray-400">
                  {PROCEDURE_LABELS[d.typeProcedure] ?? d.typeProcedure}
                  {' · '}
                  {d._count.meetings} réunion{d._count.meetings !== 1 ? 's' : ''}
                  {minutesCount > 0 && (
                    <span> · {sentCount}/{minutesCount} CR envoyé{sentCount !== 1 ? 's' : ''}</span>
                  )}
                </p>
              </div>
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
