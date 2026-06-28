import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'
import { resolveCompanyProfile, type OutcomeMeta } from '@/lib/company-import-profiles'

const log = createLogger('debt-status-classifier')

/**
 * Classifies the customer's latest message against the closed list of
 * contact-outcome categories for their specific company (from "تصنيفات
 * جميع الشركات.xlsx", seeded in company-import-profiles.ts). Returns null
 * for any portfolio without a known company profile (manual/generic
 * portfolios are untouched) or when nothing in the closed list applies —
 * the model is never allowed to invent a category outside the real list.
 */
export async function classifyDebtOutcome(args: {
  portfolio_name: string | null
  customer_message: string
}): Promise<{ category: string; meta: OutcomeMeta } | null> {
  if (!args.portfolio_name || !args.customer_message.trim()) return null

  const profile = resolveCompanyProfile(args.portfolio_name)
  if (!profile || profile.outcomeCategories.length === 0) return null

  if (!process.env.OPENROUTER_API_KEY) return null

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  const list = profile.outcomeCategories.map((c, i) => `${i + 1}. ${c}`).join('\n')

  try {
    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 60,
      messages: [
        {
          role: 'system',
          content:
            'أنت مصنّف حالات تحصيل ديون. مهمتك فقط مطابقة رسالة العميل بتصنيف واحد من القائمة المغلقة أدناه، أو إرجاع null إن لم ينطبق أي تصنيف بوضوح على الرسالة الحالية. ' +
            'ممنوع منعاً باتاً إخراج أي نص خارج القائمة. أرجع JSON فقط بالشكل: {"category": "النص الحرفي من القائمة" أو null}.',
        },
        {
          role: 'user',
          content: `القائمة المغلقة لهذه الشركة:\n${list}\n\nرسالة العميل: "${args.customer_message}"`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content
    if (!raw) return null

    const parsed = JSON.parse(raw) as { category?: string | null }
    const category = parsed.category?.trim() ?? null
    if (!category) return null

    // Closed-set enforcement — reject anything not literally in the list,
    // even if the model returned non-null (defends against hallucination).
    if (!profile.outcomeCategories.includes(category)) {
      log.warn('classifier returned category outside closed list — discarded', { category, portfolio: args.portfolio_name })
      return null
    }

    return { category, meta: profile.outcomeMeta[category] }
  } catch (err) {
    log.error('classifyDebtOutcome failed', err as Error)
    return null
  }
}
