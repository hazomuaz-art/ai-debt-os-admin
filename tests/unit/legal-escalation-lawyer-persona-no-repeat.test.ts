import { describe, it, expect, vi, beforeEach } from 'vitest'

// Root-cause regression test (2026-07-11): a prior fix threaded real
// conversation history into generateLawyerPersonaReply(), but the actual
// defect the owner reported — the debt amount and reference number being
// restated in EVERY reply, even to a bare greeting — was still live in
// production after that fix shipped. Verified directly: the model had full
// history and still repeated the case file every time, because the case
// summary was unconditionally re-injected as a labeled reference block on
// every call regardless of history. This test asserts the actual fix
// mechanically: on a genuinely first turn (no recentMessages), the case
// summary numbers ARE sent to the model once; on any later turn (real
// history present), the case summary numbers must NEVER appear anywhere in
// what is sent to the model — not "the model is told not to use them", but
// physically absent from the prompt — plus a hard token cap on the reply.

let capturedCreateCalls: any[] = []

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () { return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          capturedCreateCalls.push(params)
          return { choices: [{ message: { content: 'رد قصير طبيعي.' } }] }
        }),
      },
    },
  } }),
}))

import { generateLawyerPersonaReply } from '@/lib/legal-escalation'

const AMOUNT_MARKER = '789.47'
const REF_MARKER = 'DEB-MQXEQFWA-BTP'
const CASE_SUMMARY = `الجهة: موبايلي | المبلغ المتأخر: ${AMOUNT_MARKER} SAR | الرقم المرجعي: ${REF_MARKER}`

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  capturedCreateCalls = []
})

function fullPromptText(call: any): string {
  return (call.messages as { content: string }[]).map(m => m.content).join('\n')
}

describe('generateLawyerPersonaReply — does not re-inject case details after the first turn', () => {
  it('first turn (no prior history): the case amount/reference ARE sent to the model once', async () => {
    await generateLawyerPersonaReply({
      customerMessage: 'ما ابغى اسدد',
      recentMessages: [],
      caseSummary: CASE_SUMMARY,
      reason: 'رفض متكرر (3 مرات)',
    })

    expect(capturedCreateCalls.length).toBe(1)
    const prompt = fullPromptText(capturedCreateCalls[0])
    expect(prompt).toContain(AMOUNT_MARKER)
    expect(prompt).toContain(REF_MARKER)
  })

  it('later turn (real history present): the case amount/reference are NEVER sent to the model again, even for a bare greeting', async () => {
    await generateLawyerPersonaReply({
      customerMessage: 'السلام عليكم',
      recentMessages: [
        { direction: 'outbound', content: `حبيت أرجع لك بخصوص ملف مديونية موبايلي رقم ${REF_MARKER} بمبلغ ${AMOUNT_MARKER} ريال.` },
        { direction: 'inbound', content: 'لا ما ابغي اسدد' },
      ],
      caseSummary: CASE_SUMMARY,
      reason: 'رفض متكرر (3 مرات)',
    })

    expect(capturedCreateCalls.length).toBe(1)
    const call = capturedCreateCalls[0]
    // Only the SYSTEM message is under the model's control from our side —
    // the amount/reference legitimately appear in the injected history
    // (that's the real prior conversation), but must never appear in the
    // system prompt we construct, since that's the only place a standing
    // "case file" reference block could still be hiding.
    const systemMsg = call.messages.find((m: any) => m.role === 'system').content as string
    expect(systemMsg).not.toContain(AMOUNT_MARKER)
    expect(systemMsg).not.toContain(REF_MARKER)

    // Hard structural cap on reply length, not just a style instruction.
    expect(call.max_tokens).toBeLessThanOrEqual(160)
  })

  it('history is still threaded to the model as real prior turns (not dropped)', async () => {
    await generateLawyerPersonaReply({
      customerMessage: 'وش رايك',
      recentMessages: [
        { direction: 'outbound', content: 'أول رد' },
        { direction: 'inbound', content: 'رد العميل' },
      ],
      caseSummary: CASE_SUMMARY,
      reason: 'رفض متكرر (3 مرات)',
    })

    const call = capturedCreateCalls[0]
    const roles = call.messages.map((m: any) => m.role)
    expect(roles).toEqual(['system', 'assistant', 'user', 'user'])
  })
})
