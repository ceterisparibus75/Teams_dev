import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ status: 'non connecté' })

  let dbUser = null
  let dbError = null
  try {
    dbUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: {
        id: true,
        microsoftId: true,
        microsoftAccessToken: true,
        microsoftRefreshToken: true,
        microsoftTokenExpiry: true,
      },
    })
  } catch (e) {
    dbError = String(e)
  }

  return NextResponse.json({
    session: {
      email: session.user.email,
      id: session.user.id ?? 'NON DÉFINI',
      hasAccessToken: Boolean(session.accessToken),
    },
    db: {
      connected: dbError === null,
      error: dbError,
      userFound: Boolean(dbUser),
      hasMicrosoftId: Boolean(dbUser?.microsoftId),
      hasRefreshToken: Boolean(dbUser?.microsoftRefreshToken),
    },
  })
}
