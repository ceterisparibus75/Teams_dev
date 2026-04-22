import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name: string
      email: string
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
