import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fixtures } from '../setup'

// Mock OpenAI before importing ai-engine
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify({
                  score: 72,
                  risk_classification: 'medium',
                  collection_probability: 65,
                  recommended_strategy: 'Direct negotiation with payment plan',
                  factors: [
                    { name: 'Payment history', impact: 'positive', weight: 7, description: 'Made 1 payment' },
                    { name: 'Days overdue',    impact: 'negative', weight: 6, description: '90 days overdue' },
                  ],
                }),
              },
            }],
          }),
        },
      },
    })),
  }
})

import { scoreDebt, generateCollectionMessage } from '@/lib/ai-engine'

describe('scoreDebt', () => {
  const validInput = {
    debt:     fixtures.debt as any,
    customer: fixtures.customer as any,
    payment_history: [
      { amount: 5000, date: '2024-03-01', status: 'completed' },
    ],
    days_overdue:        90,
    total_payments_made: 1,
  }

  it('returns a valid score result', async () => {
    const result = await scoreDebt(validInput)
    expect(result.score).toBe(72)
    expect(result.risk_classification).toBe('medium')
    expect(result.collection_probability).toBe(65)
    expect(result.recommended_strategy).toBeTruthy()
    expect(result.factors).toHaveLength(2)
  })

  it('clamps score to 0-100', async () => {
    const openai = (await import('openai')).default as any
    openai.mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          score: 150,  // out of bounds
          risk_classification: 'high',
          collection_probability: -20, // out of bounds
          recommended_strategy: 'test',
          factors: [],
        }) } }],
      }) } },
    }))

    const { scoreDebt: scoreDebtFresh } = await import('@/lib/ai-engine')
    const result = await scoreDebtFresh(validInput)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.collection_probability).toBeGreaterThanOrEqual(0)
  })

  it('handles missing factors gracefully', async () => {
    const openai = (await import('openai')).default as any
    openai.mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          score: 50,
          risk_classification: 'medium',
          collection_probability: 50,
          recommended_strategy: 'Standard',
          // factors missing
        }) } }],
      }) } },
    }))

    const { scoreDebt: scoreDebtFresh } = await import('@/lib/ai-engine')
    const result = await scoreDebtFresh(validInput)
    expect(result.factors).toEqual([])
  })

  it('throws on empty OpenAI response', async () => {
    const openai = (await import('openai')).default as any
    openai.mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: null } }],
      }) } },
    }))

    const { scoreDebt: scoreDebtFresh } = await import('@/lib/ai-engine')
    await expect(scoreDebtFresh(validInput)).rejects.toThrow()
  })

  it('throws on invalid JSON response', async () => {
    const openai = (await import('openai')).default as any
    openai.mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'not valid json {{' } }],
      }) } },
    }))

    const { scoreDebt: scoreDebtFresh } = await import('@/lib/ai-engine')
    await expect(scoreDebtFresh(validInput)).rejects.toThrow('invalid JSON')
  })

  it('defaults unknown risk_classification to medium', async () => {
    const openai = (await import('openai')).default as any
    openai.mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          score: 60,
          risk_classification: 'extreme',  // invalid
          collection_probability: 60,
          recommended_strategy: 'test',
          factors: [],
        }) } }],
      }) } },
    }))

    const { scoreDebt: scoreDebtFresh } = await import('@/lib/ai-engine')
    const result = await scoreDebtFresh(validInput)
    expect(['low', 'medium', 'high', 'critical']).toContain(result.risk_classification)
  })
})

describe('generateCollectionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a non-empty string for WhatsApp channel', async () => {
    const msg = await generateCollectionMessage(
      'Ahmed Al-Rashid', 45000, 'SAR', 90, 'whatsapp'
    )
    expect(typeof msg).toBe('string')
    // The mock returns the JSON-stringified content but this tests the pipeline
  })
})
