import { describe, it, expect } from 'vitest'
import { scoringFallback } from '@/lib/ai-engine'
import { fixtures } from '../setup'

describe('scoringFallback (rule-based)', () => {
  const baseInput = {
    debt:                 fixtures.debt as any,
    customer:             fixtures.customer as any,
    payment_history:      [],
    days_overdue:         0,
    total_payments_made:  0,
  }

  it('returns a valid score object', () => {
    const result = scoringFallback(baseInput)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(['low', 'medium', 'high', 'critical']).toContain(result.risk_classification)
    expect(result.collection_probability).toBeGreaterThanOrEqual(0)
    expect(result.collection_probability).toBeLessThanOrEqual(100)
    expect(result.recommended_strategy).toBeTruthy()
    expect(Array.isArray(result.factors)).toBe(true)
    expect(result.factors.length).toBeGreaterThan(0)
  })

  it('gives higher score when not overdue', () => {
    const notOverdue  = scoringFallback({ ...baseInput, days_overdue: 0 })
    const veryOverdue = scoringFallback({ ...baseInput, days_overdue: 200 })
    expect(notOverdue.score).toBeGreaterThan(veryOverdue.score)
  })

  it('gives higher score with payment history', () => {
    const withPayments = scoringFallback({
      ...baseInput,
      total_payments_made: 3,
      payment_history: [
        { amount: 5000, date: '2024-01-01', status: 'completed' },
        { amount: 5000, date: '2024-02-01', status: 'completed' },
        { amount: 5000, date: '2024-03-01', status: 'completed' },
      ],
    })
    const noPayments = scoringFallback(baseInput)
    expect(withPayments.score).toBeGreaterThan(noPayments.score)
  })

  it('returns critical risk for very overdue debt', () => {
    const result = scoringFallback({ ...baseInput, days_overdue: 250, total_payments_made: 0 })
    expect(['high', 'critical']).toContain(result.risk_classification)
  })

  it('recommends legal action for 200+ days overdue', () => {
    const result = scoringFallback({ ...baseInput, days_overdue: 200 })
    expect(result.recommended_strategy.toLowerCase()).toMatch(/legal|write/i)
  })

  it('never throws regardless of input', () => {
    const edgeCases = [
      { ...baseInput, days_overdue: -1 },
      { ...baseInput, customer: { ...fixtures.customer, monthly_income: 0 } as any },
      { ...baseInput, customer: { ...fixtures.customer, monthly_income: null } as any },
      { ...baseInput, debt: { ...fixtures.debt, original_amount: 0, current_balance: 0 } as any },
    ]
    for (const input of edgeCases) {
      expect(() => scoringFallback(input)).not.toThrow()
    }
  })

  it('score is deterministic for same input', () => {
    const r1 = scoringFallback(baseInput)
    const r2 = scoringFallback(baseInput)
    expect(r1.score).toBe(r2.score)
    expect(r1.risk_classification).toBe(r2.risk_classification)
  })

  it('factors have required fields', () => {
    const result = scoringFallback(baseInput)
    for (const factor of result.factors) {
      expect(factor.name).toBeTruthy()
      expect(['positive', 'negative', 'neutral']).toContain(factor.impact)
      expect(factor.weight).toBeGreaterThanOrEqual(1)
      expect(factor.weight).toBeLessThanOrEqual(10)
      expect(factor.description).toBeTruthy()
    }
  })
})
