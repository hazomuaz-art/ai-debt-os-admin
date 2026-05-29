import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | null | undefined, currency = 'SAR'): string {
  if (amount == null || isNaN(amount)) return '—'
  try {
    return new Intl.NumberFormat('en-SA', {
      style:                 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('en-SA', {
      year:  'numeric',
      month: 'short',
      day:   'numeric',
    }).format(d)
  } catch {
    return '—'
  }
}

export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  try {
    const now     = new Date()
    const then    = new Date(date)
    const diffMs  = now.getTime() - then.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7)   return `${diffDays}d ago`
    if (diffDays < 30)  return `${Math.floor(diffDays / 7)}w ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  } catch {
    return '—'
  }
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active:         'bg-blue-500/10 text-blue-400 border-blue-500/20',
    in_progress:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    in_negotiation: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    payment_plan:   'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    promised:       'bg-purple-500/10 text-purple-400 border-purple-500/20',
    partial:        'bg-orange-500/10 text-orange-400 border-orange-500/20',
    settled:        'bg-green-500/10 text-green-400 border-green-500/20',
    written_off:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
    legal:          'bg-red-500/10 text-red-400 border-red-500/20',
    disputed:       'bg-rose-500/10 text-rose-400 border-rose-500/20',
  }
  return colors[status] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
}

export function getPriorityIcon(priority: string): string {
  const icons: Record<string, string> = {
    low:      '↓',
    medium:   '→',
    high:     '↑',
    critical: '⚡',
  }
  return icons[priority] ?? '→'
}

export function generateReferenceNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random    = Math.random().toString(36).substring(2, 5).toUpperCase()
  return `DEB-${timestamp}-${random}`
}

export function calculateDaysOverdue(dueDate: string | null | undefined): number {
  if (!dueDate) return 0
  try {
    const due = new Date(dueDate)
    if (isNaN(due.getTime())) return 0
    return Math.max(0, Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24)))
  } catch {
    return 0
  }
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return isNaN(n) ? fallback : n
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}
