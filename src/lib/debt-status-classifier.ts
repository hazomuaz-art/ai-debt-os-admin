import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'
import { resolveCompanyProfile, type OutcomeMeta } from '@/lib/company-import-profiles'

const log = createLogger('debt-status-classifier')

// Claude via OpenRouter often ignores response_format:json_object and wraps
// the JSON in markdown fences anyway — same proven extractor used in
// ai-collector-agent.ts for the main reply parsing.
function extractJson(raw: string): any | null {
  if (!raw) return null
  let s = String(raw).trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(s) } catch {}
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)) } catch {}
  }
  return null
}

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

  // Real root cause of the agent only ever using 1-2 categories (usually
  // "متنازع عليه"/"وعد بالسداد") despite the company having 10-30 possible
  // outcomes: the model only ever saw the BARE category NAMES here — no
  // explanation of what each one means or when it applies. Categories with
  // obvious keyword overlap with what a customer literally says (dispute,
  // payment promise) matched easily; internal collector-jargon categories
  // (e.g. "الرقم مغلق", "خروج نهائى", "تحديث") were effectively invisible
  // to the model since nothing explained them. `profile.outcomeMeta[c]`
  // already has a real Arabic `meaning` line for every category (used
  // elsewhere to drive the agent's next-turn behavior) — it just was never
  // shown to the classifier itself. Now every category is listed WITH its
  // meaning, giving the model actual grounding to match against instead of
  // guessing from a bare label.
  const list = profile.outcomeCategories
    .map((c, i) => `${i + 1}. "${c}" — ${profile.outcomeMeta[c]?.meaning ?? c}`)
    .join('\n')

  try {
    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 60,
      messages: [
        {
          role: 'system',
          content:
            'أنت مصنّف حالات تحصيل ديون. مهمتك مطابقة رسالة العميل بأدق تصنيف من القائمة المغلقة أدناه (كل تصنيف مذكور مع معناه الحقيقي)، أو إرجاع null إن لم ينطبق أي تصنيف بوضوح على الرسالة الحالية. ' +
            'اقرأ معنى كل تصنيف فعلياً قبل الاختيار — لا تكتفِ بالتصنيفات "الواضحة" مثل الاعتراض أو وعد السداد فقط؛ القائمة تشمل حالات تشغيلية أخرى (مشكلة رقم تواصل، طلب تقسيط/مهلة، مماطلة سابقة، حالة خاصة كوفاة/سجن/إفلاس، إلخ) وكل واحدة منها لها معنى محدد يجب اختياره متى ما انطبق فعلياً على كلام العميل. ' +
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

    const parsed = extractJson(raw) as { category?: string | null } | null
    const category = parsed?.category?.trim() ?? null
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
