import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression test for two real production defects (2026-07-11, owner):
// (1) the model invented a fake kunya/nickname ("أبو خالد") never present
// in the real customer data, apparently bleeding in from the collector
// persona's own name mentioned nearby in the prompt; (2) first-contact
// campaign messages never stated the actual claim details (creditor,
// amount, reference number, how overdue) — just a vague one-liner, leaving
// the recipient no way to verify what the message was even about. Also
// covers the new requirement that a non-Arabic-script customer name (real
// expatriate customers confirmed live: "ALI MUHAMMADUDDIN MUHAMMADUDDIN",
// "ABDUR RASHID") gets written to in English instead of Saudi dialect.

let mockCtx: any
let mockAiContent = 'رد تجريبي.'
let capturedCreateCalls: any[] = []

vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockCtx),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation(() => ({
            order: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(() => ({
                maybeSingle: vi.fn().mockImplementation(async () => ({ data: null })),
              })),
            })),
          })),
        })),
      })),
    })),
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          capturedCreateCalls.push(params)
          return { choices: [{ message: { content: mockAiContent } }] }
        }),
      },
    },
  })),
}))

import { generateCampaignMessage } from '@/lib/campaign-message'

function baseCtx(customerName: string) {
  return {
    verified_customer_data: { customer_name: customerName },
    verified_debt_data: {
      creditor_name: 'موبايلي',
      reference_number: 'DEB-TEST-1234',
      product_type: 'فاتورة موبايل مسبق الدفع',
      current_balance: 789.47,
      currency: 'SAR',
      due_date: '2026-06-01',
    },
    strict_rules: [],
    negotiation_profile: {},
    // No portfolio_id — the Mobily-specific per-service-status lookup is
    // skipped, and resolvePaymentReference falls through to this generic
    // metadata.extra SADAD number, the same real fallback path used for
    // every non-Mobily portfolio.
    debt: { metadata: { extra: { sadad_number: 'SADAD-TEST-9999' } } },
  }
}

function systemPromptOf(call: any): string {
  return call.messages.find((m: any) => m.role === 'system').content as string
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  capturedCreateCalls = []
  mockAiContent = 'رد تجريبي.'
})

describe('generateCampaignMessage — no invented names', () => {
  it('the "never invent a nickname" rule is present regardless of language', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    const prompt = systemPromptOf(capturedCreateCalls[0])
    expect(prompt).toMatch(/كنية|nickname/i)
  })
})

describe('generateCampaignMessage — language routing by name script', () => {
  it('an Arabic-script name gets the Saudi-dialect prompt', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    const prompt = systemPromptOf(capturedCreateCalls[0])
    expect(prompt).toContain('لهجتك السعودية')
  })

  it('a Latin-script (expatriate) name gets the English prompt instead', async () => {
    mockCtx = baseCtx('ABDUR RASHID')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    const prompt = systemPromptOf(capturedCreateCalls[0])
    expect(prompt).toContain('does not read Arabic')
    expect(prompt).not.toContain('لهجتك السعودية')
  })
})

describe('generateCampaignMessage — first message states full claim details', () => {
  it('a genuine first contact (no avoid_texts) requires the full claim in the facts block and instructions', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    const prompt = systemPromptOf(capturedCreateCalls[0])
    // Owner requirement (2026-07-11): the real payment/SADAD number, not
    // the internal file reference number, must be what's given out.
    expect(prompt).toContain('SADAD-TEST-9999')
    expect(prompt).toContain('رقم السداد الفعلي')
    expect(prompt).not.toContain('الرقم المرجعي للملف: DEB-TEST-1234')
    expect(prompt).toContain('فاتورة موبايل مسبق الدفع')
    // Owner requirement (2026-07-11): the customer's real name must be a
    // MANDATORY part of the first message, not merely available in the data.
    expect(prompt).toMatch(/اسم العميل الحقيقي.*إلزامي/)
    expect(prompt).toContain('789.47')
    expect(prompt).toMatch(/أول رسالة/)
  })

  it('a follow-up (prior campaign messages exist) uses the short-reminder instruction, not the full-details one', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
      avoid_texts: ['هلا خالد، معك خالد. عندك رصيد باقي 789.47 ريال من موبايلي.'],
    })
    const prompt = systemPromptOf(capturedCreateCalls[0])
    expect(prompt).not.toMatch(/أول رسالة/)
    expect(prompt).toContain('رسالة متابعة قصيرة')
  })
})

describe('generateCampaignMessage — no emoji (anti-ban precaution)', () => {
  it('the prompt bans emoji outright, for both languages', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    expect(systemPromptOf(capturedCreateCalls[0])).toMatch(/ممنوع استخدام أي إيموجي إطلاقاً/)

    mockCtx = baseCtx('ABDUR RASHID')
    await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    expect(systemPromptOf(capturedCreateCalls[1])).toMatch(/Never use any emoji/)
  })

  it('strips any emoji the model returns anyway, as a hard mechanical fallback', async () => {
    mockCtx = baseCtx('خالد الدويحي')
    mockAiContent = 'هلا خالد، عندك رصيد باقي 789.47 ريال 🙂 خبرني متى تسدده 📱'
    const result = await generateCampaignMessage({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      campaign_type: 'reminder', message_template: null,
    })
    expect(result).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    expect(result).toContain('789.47')
  })
})
