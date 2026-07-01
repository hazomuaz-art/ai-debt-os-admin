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
  // Real production root cause: a long, active conversation produces a
  // longer note that got cut off mid-string by max_tokens, leaving JSON with
  // no closing brace at all — the two parse attempts above both fail and the
  // note silently never updates again for that debt, forever (confirmed live
  // via a real customer stuck on a stale note for 14+ hours across 76
  // messages while every other part of the pipeline kept working fine).
  // max_tokens was raised to fix the truncation itself, but a huge
  // conversation can still occasionally exceed it — this regex fallback
  // recovers the "note" field's value even from a JSON object with no
  // closing brace, since that field is written first and is usually intact
  // even when "recommended_approach" gets cut off.
  const noteMatch = s.match(/"note"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (noteMatch) {
    try {
      const note = JSON.parse(`"${noteMatch[1]}"`)
      const approachMatch = s.match(/"recommended_approach"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      const recommended_approach = approachMatch ? JSON.parse(`"${approachMatch[1]}"`) : undefined
      return { note, recommended_approach }
    } catch {}
  }
  return null
}

/**
 * Keeps a running, always-current case note on the debt — there is no
 * "conversation ended" event in this system (every inbound message is
 * processed independently), so instead of waiting for an end-of-conversation
 * moment that never fires, this regenerates the note after every real
 * exchange (including a turn the agent chose to stay silent on — see the
 * caller in the WAHA webhook route).
 *
 * Real gap this fixes: this used to feed the model ONLY the previous note
 * (already a compressed summary) plus the single latest exchange, asking it
 * to "merge" the new bit in — a chain of summaries-of-summaries. Over a
 * longer conversation this reliably lost or garbled earlier details, which
 * is exactly the "not complete/accurate" symptom reported in production.
 * Now regenerates from the REAL recent transcript every time (same
 * generously-sized window the main collector agent itself uses), so the
 * note is always grounded in what actually happened, not in how well the
 * previous summary held up across several regenerations.
 *
 * Never blocks or breaks the reply pipeline — any failure here just leaves
 * the previous note in place and logs the error.
 */
export async function updateCaseNote(args: {
  company_id: string
  debt_id: string
}): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) return

  const svc = createServiceClient()

  try {
    const { data: debt } = await svc
      .from('debts')
      .select('status, original_sub_status, metadata, customer_id')
      .eq('id', args.debt_id)
      .maybeSingle()
    if (!debt) return

    const { data: lastPromise } = await svc
      .from('promises')
      .select('promised_date, status, notes')
      .eq('debt_id', args.debt_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Real transcript, not a chain of summaries — the actual last ~40
    // messages for this debt, oldest first, same window the main agent uses.
    const { data: history } = await svc
      .from('messages')
      .select('direction, content, sent_at')
      .eq('debt_id', args.debt_id)
      .order('sent_at', { ascending: false })
      .limit(40)
    const transcript = (history ?? [])
      .slice().reverse()
      .map((m: { direction: string; content: string | null }) => `${m.direction === 'inbound' ? 'العميل' : 'الوكيل'}: ${m.content ?? ''}`)
      .join('\n')

    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const facts = [
      `حالة الدين الحالية: ${debt.status ?? 'غير محدد'}`,
      debt.original_sub_status ? `آخر تصنيف: ${debt.original_sub_status}` : null,
      lastPromise ? `آخر وعد مسجَّل: ${lastPromise.promised_date} (${lastPromise.status})` : 'لا يوجد وعد مسجَّل',
    ].filter(Boolean).join('\n')

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0,
      // Was 260 — root cause of the case note silently freezing forever on
      // any sufficiently long/active conversation: a 3-5 sentence Arabic
      // summary plus the recommended_approach field routinely exceeds 260
      // tokens once there's real substance to summarize (promises, disputes,
      // multiple topics), truncating the JSON mid-string so it can never be
      // parsed — confirmed live in production (a real debt stuck on a
      // 14+ hour stale note across 76 messages, logging "no usable note" on
      // every single turn since). 600 gives enough headroom for a genuinely
      // long conversation's summary without ever hitting this ceiling.
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content:
            'أنت تكتب "إفادة حالة" مختصرة وكاملة لملف تحصيل دين، تُقرأ من قبل محصّل بشري لاحقاً بدل ما يقرأ كل المحادثة. ' +
            'اكتب وقائع فقط من المحادثة الحقيقية والمعطيات أدناه — ممنوع منعاً باتاً اختراع أي تفصيل غير موجود فيها. ' +
            'اقرأ المحادثة الكاملة أدناه (لا آخر رسالة فقط) وأنتج إفادة تلخّص كل ما حصل من البداية: من هو العميل وموقفه، وش اتفق عليه أو اختلف عليه، وأي نقطة معلّقة أو تحتاج متابعة — ملخّص كامل وحقيقي وليس فقط آخر تبادل. ' +
            'أرجع JSON فقط بالشكل: {"note": "3-5 جمل، ملخّص كامل للحالة من بداية المحادثة حتى الآن، وما اتُّفق عليه وأي نقطة خلاف أو طلب معلَّق", "recommended_approach": "جملة واحدة، خطوة عملية محددة للمتابعة"}.',
        },
        {
          role: 'user',
          content: `${facts}\n\n═══ المحادثة الكاملة (الأقدم أولاً) ═══\n${transcript || 'لا توجد رسائل سابقة'}`,
        },
      ],
      response_format: { type: 'json_object' },
    })

    const raw = completion.choices[0]?.message?.content
    const parsed = raw ? extractJson(raw) as { note?: string; recommended_approach?: string } | null : null
    const note = parsed?.note?.trim()
    const recommendedApproach = parsed?.recommended_approach?.trim()
    if (!note) {
      log.warn('case note generation returned no usable note — previous note left untouched', { debt_id: args.debt_id })
      return
    }

    await svc.from('debts').update({
      metadata: {
        ...(debt.metadata as Record<string, unknown> ?? {}),
        case_note: note,
        recommended_approach: recommendedApproach ?? null,
        case_note_updated_at: new Date().toISOString(),
      },
    }).eq('id', args.debt_id)
    log.info('case note updated', { debt_id: args.debt_id })
  } catch (err) {
    log.error('updateCaseNote failed — previous note left untouched', err as Error)
  }
}
