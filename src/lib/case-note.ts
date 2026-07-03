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
 * Real complaint this fixes: the note used to summarize the ENTIRE
 * conversation from the beginning every time, reading almost like a
 * transcript rewrite — but the full conversation is already shown in its
 * own section on the debt page (debt.messages), so repeating it here just
 * made the note long and hard to scan. A collector opening the case needs
 * "what's the situation RIGHT NOW" at a glance; the full history is one
 * scroll away if they need it. The note is still generated from the real
 * recent transcript (not a chain of summaries-of-summaries, which is what
 * caused the earlier "lost/garbled details" problem), but the OUTPUT is now
 * the current state only, not a chronicle of everything that happened.
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
    // Real gap this fixes: the very first outbound message(s) to a customer
    // (e.g. an identity-confirmation opener) are sent before any debt_id is
    // resolved, so they're stored with debt_id=null — a bare debt_id filter
    // permanently loses them once the debt resolves, leaving the case note
    // blind to what a terse early reply ("لا") was actually answering.
    // Scoping by customer_id (already fetched above) with debt_id match OR
    // null keeps that opener visible, same fix applied in
    // debt-status-classifier.ts.
    const { data: history } = await svc
      .from('messages')
      .select('direction, content, sent_at')
      .eq('customer_id', debt.customer_id)
      .or(`debt_id.eq.${args.debt_id},debt_id.is.null`)
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
            'أنت تكتب "إفادة حالة" مختصرة لملف تحصيل دين، تُقرأ من قبل محصّل بشري قبل ما يتواصل مع العميل. ' +
            'المحادثة الكاملة نفسها معروضة بشكل منفصل وبالتفصيل في نفس الصفحة — دورك هنا مختلف: تعطي المحصّل "الوضع الحالي" بلمحة سريعة، مو تعيد سرد كل المحادثة من البداية. ' +
            'اكتب وقائع فقط من المحادثة الحقيقية والمعطيات أدناه — ممنوع منعاً باتاً اختراع أي تفصيل غير موجود فيها. ' +
            'اقرأ المحادثة كاملة أدناه لتفهم السياق، لكن اكتب فقط عن آخر تطور/نقطة وصلت لها الحالة الآن — مثل: آخر شي قاله العميل أو اتفق عليه، وأي نقطة معلّقة تحتاج متابعة فورية. لا تسرد تاريخ المحادثة كامل ولا كل ما قيل من البداية. ' +
            'أرجع JSON فقط بالشكل: {"note": "1-2 جملة فقط، آخر تطور/الوضع الحالي تحديداً — مو ملخص كامل للمحادثة", "recommended_approach": "جملة واحدة، خطوة عملية محددة للمتابعة"}.',
        },
        {
          role: 'user',
          content: `${facts}\n\n═══ المحادثة (للسياق فقط — لا تلخّصها كاملة) ═══\n${transcript || 'لا توجد رسائل سابقة'}`,
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

    const { error: caseNoteUpdErr } = await svc.from('debts').update({
      metadata: {
        ...(debt.metadata as Record<string, unknown> ?? {}),
        case_note: note,
        recommended_approach: recommendedApproach ?? null,
        case_note_updated_at: new Date().toISOString(),
      },
    }).eq('id', args.debt_id)
    if (caseNoteUpdErr) { log.error('case note update failed', new Error(caseNoteUpdErr.message), { debt_id: args.debt_id }); return }
    log.info('case note updated', { debt_id: args.debt_id })
  } catch (err) {
    log.error('updateCaseNote failed — previous note left untouched', err as Error)
  }
}
