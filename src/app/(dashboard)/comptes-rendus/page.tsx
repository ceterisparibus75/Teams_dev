import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui'
import Link from 'next/link'

const statusConfig: Record<string, { label: string; variant: 'default' | 'warning' | 'success' | 'info' }> = {
  DRAFT:     { label: 'Brouillon', variant: 'warning' },
  VALIDATED: { label: 'Validé',    variant: 'info'    },
  SENT:      { label: 'Envoyé',    variant: 'success' },
}

export default async function ComptesRendusPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null

  const minutes = await prisma.meetingMinutes.findMany({
    where: {
      meeting: {
        OR: [
          { organizerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    },
    include: {
      meeting: true,
      author: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Comptes rendus</h1>
      {minutes.length === 0 && (
        <p className="text-sm text-gray-500">Aucun compte rendu pour l&apos;instant.</p>
      )}
      <div className="space-y-3">
        {minutes.map((m) => {
          const s = statusConfig[m.status]
          return (
            <Link
              key={m.id}
              href={`/comptes-rendus/${m.id}`}
              className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900">{m.meeting.subject}</p>
                <p className="text-sm text-gray-500">
                  {formatDateTime(m.meeting.startDateTime)} · par {m.author.name}
                </p>
              </div>
              <Badge variant={s.variant}>{s.label}</Badge>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
