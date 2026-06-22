import { NextRequest, NextResponse } from 'next/server'
import { runCollectorAgent } from '@/lib/ai-collector-agent'

/**
 * Diagnostic dry-run of the REAL collector agent.
 *
 * Runs the exact `runCollectorAgent` used by the WhatsApp webhook against a
 * real customer + message and returns its decision — WITHOUT sending any
 * WhatsApp message or recording a promise. Lets us prove on production that a
 * given scenario (e.g. "بكرا بسدد") now decides record_promise instead of
 * looping, without disturbing a real customer.
 *
 * Auth: APP_SECRET / CRON_SECRET bearer (same as the cron endpoints).
 * Body: { company_id, customer_id, debt_id?, message }
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body?.company_id || !body?.customer_id || !body?.message) {
    return NextResponse.json({ error: 'company_id, customer_id and message are required' }, { status: 400 })
  }

  const decision = await runCollectorAgent({
    company_id: String(body.company_id),
    customer_id: String(body.customer_id),
    debt_id: body.debt_id ? String(body.debt_id) : null,
    message: String(body.message),
  })

  return NextResponse.json({
    decision: {
      action: decision.action,
      reason: decision.reason,
      promised_date: decision.promised_date ?? null,
      promise_text: decision.promise_text ?? null,
      message: decision.message,
      shouldReply: decision.shouldReply,
    },
  })
}
