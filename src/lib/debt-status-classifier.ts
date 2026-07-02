import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/server'
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
  // Real production root cause this fixes: the classifier previously only
  // ever saw the current turn's bare text in total isolation — no idea what
  // it was actually replying to. Confirmed live in production: a customer's
  // plain "لا" (answering an unrelated identity-confirmation question) and a
  // hypothetical question ("طيب اذا ماسددت وش بصير؟") and an explicit denial
  // of ever raising a dispute ("اي اعتراض انا ما قلت اني معترض") were ALL
  // misclassified as "العميل رافض السداد" (customer refuses to pay) — none
  // of them are an actual definitive refusal. Passing debt_id lets this
  // function pull a few real prior turns for grounding, the same way the
  // main collector agent and case-note generator already do; without it,
  // behavior is unchanged (still works with bare text, e.g. from tests).
  debt_id?: string | null
}): Promise<{ category: string; meta: OutcomeMeta } | null> {
  if (!args.portfolio_name || !args.customer_message.trim()) return null

  const profile = resolveCompanyProfile(args.portfolio_name)
  if (!profile || profile.outcomeCategories.length === 0) return null

  if (!process.env.OPENROUTER_API_KEY) return null

  let contextBlock = ''
  if (args.debt_id) {
    const svc = createServiceClient()
    const blocks: string[] = []

    // Real gap found in a follow-up audit: this only ever saw the last 8 RAW
    // messages — a fact the customer stated clearly earlier in a long
    // conversation (more than ~8 turns back) and never repeated was
    // invisible to every later classification call, since each call gets a
    // fresh, shallow window rather than any memory of the case so far. The
    // running case note (updateCaseNote in case-note.ts) already summarizes
    // the ENTIRE conversation from the start on every real turn — reusing it
    // here gives the classifier real full-history awareness, not just a
    // recent snippet, at zero extra LLM calls. Fetched independently from
    // the recent-messages query below (separate try/catch each) so a
    // failure fetching one never discards the other — that coupling was a
    // real regression caught in testing before this ever shipped.
    try {
      const { data: debtRow } = await svc
        .from('debts').select('metadata').eq('id', args.debt_id).maybeSingle()
      const caseNote = (debtRow?.metadata as Record<string, unknown> | null)?.case_note as string | undefined
      if (caseNote) blocks.push(`ملخص كامل المحادثة حتى الآن:\n${caseNote}`)
    } catch (err) {
      log.warn('failed to fetch case note for classification context', { error: String((err as any)?.message ?? err) })
    }

    try {
      const { data: history } = await svc
        .from('messages')
        .select('direction, content, sent_at')
        .eq('debt_id', args.debt_id)
        .order('sent_at', { ascending: false })
        .limit(8)
      const prior = (history ?? []).slice().reverse()
        .map((m: { direction: string; content: string | null }) => `${m.direction === 'inbound' ? 'العميل' : 'الوكيل'}: ${m.content ?? ''}`)
        .join('\n')
      if (prior) blocks.push(`سياق المحادثة — آخر الرسائل قبل هذه الرسالة (الأقدم أولاً):\n${prior}`)
    } catch (err) {
      log.warn('failed to fetch recent messages for classification context', { error: String((err as any)?.message ?? err) })
    }

    if (blocks.length) contextBlock = `\n\n${blocks.join('\n\n')}\n`
  }

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
            'اقرأ سياق المحادثة إن وُجد لتفهم معنى الرسالة الحالية فعلياً قبل التصنيف — رسالة قصيرة أو غامضة بمعزل عن السياق قد تُفهم خطأ. ' +
            'أرجع null إلزامياً في هذه الحالات، ولا تصنّف شيئاً غامضاً كموقف نهائي: ' +
            '(أ) ردّ قصير غامض (مثل "لا"، "طيب"، "أوك") لا يتعلق وضوحاً بالسداد أو الدين — تحقق من السياق قبل افتراض أنه عن الدين. ' +
            '(ب) سؤال افتراضي/شرطي عن العواقب (مثل "لو ما سددت وش بصير؟") — هذا استفسار وليس رفضاً فعلياً للسداد. ' +
            '(ج) العميل ينفي أنه قال شيئاً معيناً سابقاً (مثل "انا ما قلت اني معترض") — هذا تصحيح/نفي لكلام سابق، وليس تصنيفاً جديداً بحد ذاته. ' +
            'اختر تصنيفاً فقط عندما تكون رسالة العميل تصريحاً واضحاً وقاطعاً ينطبق فعلياً على معنى أحد التصنيفات. ' +
            'ممنوع منعاً باتاً إخراج أي نص خارج القائمة. أرجع JSON فقط بالشكل: {"category": "النص الحرفي من القائمة" أو null}.',
        },
        {
          role: 'user',
          content: `القائمة المغلقة لهذه الشركة:\n${list}${contextBlock}\n\nرسالة العميل الحالية (هي فقط المطلوب تصنيفها): "${args.customer_message}"`,
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
