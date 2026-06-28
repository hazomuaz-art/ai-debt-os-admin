import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { validateEnv, isWhatsAppConfigured, isOpenAIConfigured } from '@/lib/env'

// Store original env
const originalEnv = { ...process.env }

describe('validateEnv', () => {
  afterEach(() => {
    // Restore env after each test
    Object.keys(process.env).forEach(k => {
      if (!(k in originalEnv)) delete process.env[k]
    })
    Object.assign(process.env, originalEnv)
  })

  it('passes with all required vars set', () => {
    const result = validateEnv()
    // setup.ts sets valid values
    expect(result.valid).toBe(true)
    expect(result.missing).toHaveLength(0)
    expect(result.invalid).toHaveLength(0)
  })

  it('reports missing required vars', () => {
    delete process.env.OPENROUTER_API_KEY
    const result = validateEnv()
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('OPENROUTER_API_KEY')
  })

  it('reports invalid Supabase URL', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://not-supabase.com'
    const result = validateEnv()
    expect(result.valid).toBe(false)
    expect(result.invalid.map(i => i.key)).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('reports invalid OpenAI key format', () => {
    process.env.OPENROUTER_API_KEY = 'not-starting-with-sk'
    const result = validateEnv()
    expect(result.valid).toBe(false)
    expect(result.invalid.map(i => i.key)).toContain('OPENROUTER_API_KEY')
  })

  it('reports short APP_SECRET', () => {
    process.env.APP_SECRET = 'short'
    const result = validateEnv()
    expect(result.valid).toBe(false)
    expect(result.invalid.map(i => i.key)).toContain('APP_SECRET')
  })

  it('warns about missing optional vars', () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID
    delete process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_VERIFY_TOKEN
    const result = validateEnv()
    // Optional — should still be valid
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('warns when WhatsApp is partially configured', () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123'
    delete process.env.WHATSAPP_ACCESS_TOKEN
    delete process.env.WHATSAPP_VERIFY_TOKEN
    const result = validateEnv()
    const hasPartialWarning = result.warnings.some(w => w.includes('partially'))
    expect(hasPartialWarning).toBe(true)
  })
})

describe('isWhatsAppConfigured', () => {
  afterEach(() => Object.assign(process.env, originalEnv))

  it('returns true when all WhatsApp vars set', () => {
    expect(isWhatsAppConfigured()).toBe(true)
  })

  it('returns false when any var missing', () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN
    expect(isWhatsAppConfigured()).toBe(false)
  })
})

describe('isOpenAIConfigured', () => {
  afterEach(() => Object.assign(process.env, originalEnv))

  it('returns true when key set', () => {
    expect(isOpenAIConfigured()).toBe(true)
  })

  it('returns false when key missing', () => {
    delete process.env.OPENROUTER_API_KEY
    expect(isOpenAIConfigured()).toBe(false)
  })
})
