import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { insertSystemAlert } from '@/lib/system-alerts'
import { createLogger } from '@/lib/logger'
import type { AlertSeverity } from '@/types/index'

const log = createLogger('cron/whatsapp-health')

/**
 * Periodic WhatsApp health check.
 *
 * Detects two failure modes and raises a dashboard alert (system_alerts):
 *  1. The WhatsApp instance is disconnected (state != "open").
 *  2. A "silent block": outbound messages are accepted by the gateway but
 *     never actually delivered to recipients (delivery ratio collapses).
 *
 * Alerts are de-duplicated: a new one is only created when there is no
 * matching unresolved alert already open.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const result: Record<string, unknown> = {}

  // company to attach the alert to (single-tenant in practice)
  const { data: lastMsg } = await supabase
    .from('messages').select('company_id')
    .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const company_id = (lastMsg as { company_id?: string } | null)?.company_id ?? null

  // raise an alert only if no unresolved one of the same type exists
  const raise = async (alert_type: string, severity: AlertSeverity, title: string, message: string, metadata: Record<string, unknown>) => {
    let q = supabase.from('system_alerts').select('id').eq('alert_type', alert_type).eq('is_resolved', false)
    q = company_id ? q.eq('company_id', company_id) : q.is('company_id', null)
    const { data: existing } = await q.limit(1).maybeSingle()
    if (existing) return false
    await insertSystemAlert({ company_id, alert_type, severity, title, message, metadata })
    return true
  }

  // 1) connection state — WAHA session status (WORKING == connected)
  const base = (process.env.WAHA_API_URL ?? '').replace(/\/$/, '')
  const session = process.env.WAHA_SESSION || 'default'
  const apikey = process.env.WAHA_API_KEY
  let state = 'unknown'
  try {
    const r = await fetch(`${base}/api/sessions/${session}`, { headers: { 'X-Api-Key': apikey ?? '' } })
    const j = await r.json()
    // WAHA reports "WORKING" when the session is connected and authenticated.
    state = j?.status === 'WORKING' ? 'open' : String(j?.status ?? 'unknown').toLowerCase()
  } catch (e) {
    log.error('WAHA session status check failed', e)
  }
  result.state = state
  if (state !== 'open') {
    result.connectionAlert = await raise(
      'whatsapp_disconnected', 'critical',
      'انقطاع اتصال واتساب',
      `رقم واتساب غير متصل حالياً (الحالة: ${state}). الوكيل لا يستطيع إرسال أو استقبال الرسائل حتى تتم إعادة الربط.`,
      { state, session },
    )
  }

  // 2) delivery health — outbound messages sent in the last 3h, old enough
  // (>10 min) to have been acked, that never reached "delivered"/"read".
  const since = new Date(Date.now() - 3 * 3600_000).toISOString()
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: recent } = await supabase
    .from('messages').select('status')
    .eq('direction', 'outbound').eq('channel', 'whatsapp')
    .gte('sent_at', since).lte('sent_at', cutoff)
    .limit(500)

  const rows = recent ?? []
  const total = rows.length
  const delivered = rows.filter((r: { status: string }) => ['delivered', 'read'].includes(r.status)).length
  const ratio = total ? delivered / total : 1
  result.total = total
  result.delivered = delivered
  result.ratio = Number(ratio.toFixed(2))

  // need a meaningful sample before alerting, and a clearly broken ratio
  if (total >= 5 && ratio < 0.3) {
    result.deliveryAlert = await raise(
      'whatsapp_delivery_failure', 'critical',
      'رسائل البوت لا تصل للعملاء',
      `من أصل ${total} رسالة أرسلها الوكيل في آخر 3 ساعات، لم يصل سوى ${delivered}. هذا يدل على حظر صامت من واتساب — الرسائل تُقبل لكنها لا تُسلَّم. يُنصح بإيقاف الإرسال ومراجعة الرقم.`,
      { total, delivered, ratio: result.ratio },
    )
  }

  log.info('whatsapp-health run', result)
  return NextResponse.json({ message: 'done', result })
}
