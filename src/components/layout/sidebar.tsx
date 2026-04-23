'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Video, FileText, Settings, LogOut, FolderOpen, Bot } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/dashboard',      label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/dossiers',       label: 'Dossiers',         icon: FolderOpen },
  { href: '/reunions',       label: 'Réunions Teams',   icon: Video },
  { href: '/comptes-rendus', label: 'Comptes rendus',   icon: FileText },
  { href: '/parametres',     label: 'Templates',        icon: Settings },
  { href: '/prompts',        label: 'Prompts IA',       icon: Bot },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">BL & Associés</p>
        <h1 className="text-base font-bold text-gray-900 mt-1">Comptes rendus</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname.startsWith(href) ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname.startsWith(href)
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-600 hover:bg-gray-50'
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-100">
        <button
          onClick={() => signOut({ callbackUrl: '/signin' })}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <LogOut size={18} />
          Se déconnecter
        </button>
      </div>
    </aside>
  )
}
