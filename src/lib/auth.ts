import { NextAuthOptions } from 'next-auth'
import AzureADProvider from 'next-auth/providers/azure-ad'
import { prisma } from '@/lib/prisma'
import { MICROSOFT_AUTHORIZATION_SCOPE } from '@/lib/microsoft-scopes'

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: {
        params: {
          scope: MICROSOFT_AUTHORIZATION_SCOPE,
        },
      },
      checks: ['state'],
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        // Utiliser le claim 'oid' (Object ID Azure AD) — toujours un vrai GUID
        // providerAccountId peut être le claim 'sub' qui n'est pas toujours un GUID valide
        const oid = (profile as { oid?: string } | undefined)?.oid ?? account.providerAccountId
        token.microsoftId = oid
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at

        try {
          await prisma.user.upsert({
            where: { email: token.email! },
            update: {
              name: token.name ?? '',
              microsoftId: oid,
              microsoftAccessToken: account.access_token ?? null,
              microsoftRefreshToken: account.refresh_token ?? null,
              microsoftTokenExpiry: account.expires_at
                ? new Date(account.expires_at * 1000)
                : null,
            },
            create: {
              email: token.email!,
              name: token.name ?? '',
              microsoftId: oid,
              microsoftAccessToken: account.access_token ?? null,
              microsoftRefreshToken: account.refresh_token ?? null,
              microsoftTokenExpiry: account.expires_at
                ? new Date(account.expires_at * 1000)
                : null,
            },
          })
        } catch (dbError) {
          console.error('[auth] Prisma upsert failed:', dbError)
        }
      }
      return token
    },
    async session({ session, token }) {
      try {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email! },
          select: { id: true, role: true },
        })
        if (user) {
          session.user.id = user.id
          session.user.role = user.role
        }
      } catch (dbError) {
        console.error('[auth] session DB lookup failed:', dbError)
      }
      session.accessToken = token.accessToken as string | undefined
      return session
    },
  },
  pages: { signIn: '/signin' },
}
