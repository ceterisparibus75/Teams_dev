import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info'

const variants: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  destructive: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-800',
}

export function Badge({
  variant = 'default',
  children,
  className,
}: {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
