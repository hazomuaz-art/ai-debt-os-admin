import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  formatDate,
  calculateDaysOverdue,
  generateReferenceNumber,
  getStatusColor,
  cn,
} from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats SAR correctly', () => {
    const result = formatCurrency(50000, 'SAR')
    expect(result).toContain('50')
    expect(result).toContain('000')
  })

  it('handles zero', () => {
    const result = formatCurrency(0, 'SAR')
    expect(result).toBeTruthy()
    expect(result).toContain('0')
  })

  it('handles decimal amounts', () => {
    const result = formatCurrency(1234.56, 'USD')
    expect(result).toContain('1')
    expect(result).toContain('234')
  })

  it('handles large amounts without overflow', () => {
    const result = formatCurrency(1_000_000, 'SAR')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('handles negative amounts gracefully', () => {
    const result = formatCurrency(-100, 'SAR')
    expect(typeof result).toBe('string')
  })
})

describe('calculateDaysOverdue', () => {
  it('returns 0 for future due dates', () => {
    const future = new Date()
    future.setDate(future.getDate() + 30)
    const result = calculateDaysOverdue(future.toISOString().split('T')[0])
    expect(result).toBe(0)
  })

  it('returns positive number for past due dates', () => {
    const past = new Date()
    past.setDate(past.getDate() - 10)
    const result = calculateDaysOverdue(past.toISOString().split('T')[0])
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(11) // allow 1-day buffer
  })

  it('returns 0 for today', () => {
    const today = new Date().toISOString().split('T')[0]
    const result = calculateDaysOverdue(today)
    expect(result).toBe(0)
  })

  it('handles invalid date string gracefully', () => {
    expect(() => calculateDaysOverdue('invalid')).not.toThrow()
  })
})

describe('generateReferenceNumber', () => {
  it('generates a non-empty string', () => {
    const ref = generateReferenceNumber()
    expect(typeof ref).toBe('string')
    expect(ref.length).toBeGreaterThan(4)
  })

  it('generates unique values', () => {
    const refs = new Set(Array.from({ length: 100 }, () => generateReferenceNumber()))
    expect(refs.size).toBeGreaterThan(90) // allow some collision probability
  })

  it('contains only safe characters', () => {
    const ref = generateReferenceNumber()
    expect(ref).toMatch(/^[A-Z0-9\-]+$/)
  })
})

describe('getStatusColor', () => {
  it('returns a string for known statuses', () => {
    const statuses = ['active', 'settled', 'legal', 'written_off', 'in_negotiation']
    for (const status of statuses) {
      const color = getStatusColor(status)
      expect(typeof color).toBe('string')
      expect(color.length).toBeGreaterThan(0)
    }
  })

  it('returns a string for unknown status', () => {
    const color = getStatusColor('unknown_status')
    expect(typeof color).toBe('string')
  })
})

describe('cn (className utility)', () => {
  it('merges class names', () => {
    const result = cn('base-class', 'extra-class')
    expect(result).toContain('base-class')
    expect(result).toContain('extra-class')
  })

  it('handles conditional classes', () => {
    const result = cn('base', false && 'not-included', 'included')
    expect(result).toContain('base')
    expect(result).toContain('included')
    expect(result).not.toContain('not-included')
  })

  it('handles tailwind conflicts (merge)', () => {
    // tailwind-merge resolves conflicts
    const result = cn('p-2', 'p-4')
    expect(result).toContain('p-4')
    expect(result).not.toContain('p-2')
  })

  it('handles empty input', () => {
    const result = cn()
    expect(typeof result).toBe('string')
  })
})

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2024-06-15')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles null/undefined gracefully', () => {
    expect(formatDate(null as any)).toBeTruthy()
    expect(formatDate(undefined as any)).toBeTruthy()
  })
})
