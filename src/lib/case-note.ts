import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('case-note')

// Same proven fence-stripper used in debt-status-classifier.ts /
// ai-collector-agent.ts — Claude via OpenRouter often ignores
// response_format:json_object and wraps the JSON in markdown fences anyway.
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
 * Keeps a running, always-current case note on the debt — there is no
 * "conversation ended" event in this system (every inbound message is
 * processed independently), so instead of waiting for an end-of-conversation
 * moment that never fires, this regenerates the note after every real
 * exchange. Lets a human (or a future agent run) open the debt and know
 * "what happened" in 2-3 sentences without re-reading the whole thread.
 *
 * Never blocks or breaks the reply pipeline — any failure here just leaves
 * the previous note in place and logs the error.
 */
export async function updateCaseNote(args: {
  company_id: string
  debt_id: string
  customer_message: string
  agent_message: string
}): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) return

  const svc = createServiceClient()

  try {
    const { data: debt } = await svc
      .from('debts')
      .select('status, original_sub_status, metadata')
      .eq('id', args.debt_id)
      .maybeSingle()
    if (!debt) return

    const previousNote = (debt.metadata as any)?.case_note ?? null

    const { data: lastPromise } = await svc
      .from('promises')
      .select('promised_date, status, notes')
      .eq('debt_id', args.debt_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const facts = [
      `حالة الدين الحالية: ${debt.status ?? 'غير محدد'}`,
      debt.original_sub_status ? `آخر تصنيف: ${debt.original_sub_status}` : null,
      lastPromise ? `آخر وعد مسجَّل: ${lastPromise.promised_date} (${lastPromise.status})` : 'لا يوجد وعد مسجَّل',
      previousNote ? `الإفادة السابقة: ${previousNote}` : 'لا توجد إفادة سابقة',
    ].filter(Boolean).join('\n')

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content:
            'أنت تكتب "إفادة حالة" مختصرة لملف تحصيل دين، تُقرأ من قبل محصّل بشري لاحقاً. ' +
            'اكتب وقائع فقط من المعطيات الحقيقية أدناه — ممنوع منعاً باتاً اختراع أي تفصيل غير موجود فيها. ' +
            'حدّث الإفادة السابقة (إن وُجدت) بدمج آخر تبادل، لا تكررها كما هي ولا تتجاهلها. ' +
            'أرجع JSON فقط بالشكل: {"note": "2-3 جمل، الوضع الحالي وما اتُّفق عليه وأي نقطة خلاف", "recommended_approach": "جملة واحدة، خطوة عملية محددة للمتابعة"}.',
        },
        {
          role: 'user',
          content: `${facts}\n\nرسالة العميل الأخيرة: "${args.customer_message}"\nرد الوكيل: "${args.agent_message}"`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content
    const parsed = raw ? extractJson(raw) as { note?: string; recommended_approach?: string } | null : null
    const note = parsed?.note?.trim()
    const recommendedApproach = parsed?.recommended_approach?.trim()
    if (!note) return

    await svc.from('debts').update({
      metadata: {
        ...(debt.metadata as Record<string, unknown> ?? {}),
        case_note: note,
        recommended_approach: recommendedApproach ?? null,
        case_note_updated_at: new Date().toISOString(),
      },
    }).eq('id', args.debt_id)
  } catch (err) {
    log.error('updateCaseNote failed — previous note left untouched', err as Error)
  }
}
