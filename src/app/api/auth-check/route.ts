import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID ? `${process.env.AZURE_AD_CLIENT_ID.substring(0, 8)}…` : 'MANQUANT',
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET ? `${process.env.AZURE_AD_CLIENT_SECRET.substring(0, 4)}…` : 'MANQUANT',
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID ? `${process.env.AZURE_AD_TENANT_ID.substring(0, 8)}…` : 'MANQUANT',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? 'MANQUANT',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'OK' : 'MANQUANT',
    DATABASE_URL: process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 20)}…` : 'MANQUANT',
  })
}
