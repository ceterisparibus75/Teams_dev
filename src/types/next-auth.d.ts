import 'next-auth'
import 'next-auth/jwt'
import type { UserRole } from '@prisma/client'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: UserRole
    }
    accessToken?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    microsoftId?: string
    accessToken?: string
    refreshToken?: string
    accessTokenExpires?: number
  }
}
