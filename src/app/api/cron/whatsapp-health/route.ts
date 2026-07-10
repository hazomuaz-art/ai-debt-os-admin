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
  // Root-cause production-readiness audit finding (2026-07-09): this used
  // to "fail open" - if NEITHER APP_SECRET nor CRON_SECRET was configured
  // (a real, plausible env misconfiguration), the auth check below was
  // skipped entirely and this route ran fully unauthenticated for anyone
  // with the URL. A missing secret is now treated as a server
  // misconfiguration (500), never as "allow everyone".
  if (!process.env.APP_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: no cron secret set' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const result: Record<string, unknown> = {}

  // company to attach the alert to (single-tenant in practice)
  const { data: lastMsg } = await supabase
    .from('messages').select('company_id')
    .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle()
  const company_id = (lastMsg as { company_id?: string } | null)?.company_id ?? null

  // raise an alert only if no unresolved one of the same type exists.
  // `forCompanyId` defaults to the single-tenant fallback (`company_id`,
  // derived from the most recent message) but the per-number connection
  // check below always passes the number's OWN company_id explicitly, so a
  // secondary number's alert is never misattributed to whichever company
  // happened to send the most recent message platform-wide.
  const raise = async (alert_type: string, severity: AlertSeverity, title: string, message: string, metadata: Record<string, unknown>, forCompanyId: string | null = company_id) => {
    let q = supabase.from('system_alerts').select('id').eq('alert_type', alert_type).eq('is_resolved', false)
    q = forCompanyId ? q.eq('company_id', forCompanyId) : q.is('company_id', null)
    const { data: existing } = await q.limit(1).maybeSingle()
    if (existing) return false
    await insertSystemAlert({ company_id: forCompanyId, alert_type, severity, title, message, metadata })
    return true
  }

  // 🔴 Real gap this fixes: this cron only ever RAISED alerts, never
  // resolved them — confirmed live, a real WhatsApp disconnection/delivery-
  // failure pair from 2026-07-06 sat unresolved in the dashboard for two
  // days even after the session was manually reconnected and confirmed
  // WORKING, permanently blocking the send-gate circuit breaker (which
  // refuses to send while ANY of these alert types are unresolved) from
  // ever letting campaigns resume without a human manually clearing the
  // alert in the database. A delivery-failure alert is typically a symptom
  // of a bad connection in the first place, so resolving both together on
  // a confirmed-healthy reconnect is safe — any NEW real degradation is
  // still caught immediately by send-gate's own finer-grained, real-time
  // delivery-quality check (isDeliveryQualityHealthy), which runs fresh
  // before every campaign batch regardless of this cron's 30-minute cadence.
  const resolveOpen = async (alert_type: string, forCompanyId: string | null) => {
    let q = supabase.from('system_alerts').update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .eq('alert_type', alert_type).eq('is_resolved', false)
    q = forCompanyId ? q.eq('company_id', forCompanyId) : q.is('company_id', null)
    const { error } = await q
    if (error) log.error('failed to auto-resolve alert', new Error(error.message), { alert_type })
  }

  // 1) connection state — WAHA session status (WORKING == connected).
  // Real gap this fixes: this only ever checked the ONE hardcoded default
  // WAHA_SESSION/WAHA_API_URL env pair — a company with multiple WhatsApp
  // numbers (portfolio_whatsapp_numbers, used by send-campaign-queue) could
  // have a SECONDARY number silently disconnected forever and this check
  // would never notice, since "some other number is healthy" was enough to
  // make the single hardcoded check pass. Now checks every active number
  // and raises a per-company, per-number alert.
  const defaultBase = (process.env.WAHA_API_URL ?? '').replace(/\/$/, '')
  const defaultSession = process.env.WAHA_SESSION || 'default'
  const defaultApikey = process.env.WAHA_API_KEY

  const { data: activeNumbers } = await supabase
    .from('portfolio_whatsapp_numbers')
    .select('id, company_id, instance_name, api_url, display_name, is_active')
    .eq('is_active', true)

  const numbersToCheck = (activeNumbers?.length ?? 0) > 0
    ? (activeNumbers as any[])
    : [{ id: 'default', company_id, instance_name: defaultSession, api_url: defaultBase, display_name: 'default' }]

  const connectionAlerts: Record<string, unknown> = {}
  for (const num of numbersToCheck) {
    const base = (num.api_url || defaultBase).replace(/\/$/, '')
    const session = num.instance_name || defaultSession
    let state = 'unknown'
    try {
      const r = await fetch(`${base}/api/sessions/${session}`, { headers: { 'X-Api-Key': defaultApikey ?? '' } })
      const j = await r.json()
      state = j?.status === 'WORKING' ? 'open' : String(j?.status ?? 'unknown').toLowerCase()
    } catch (e) {
      log.error('WAHA session status check failed', e, { session })
    }
    connectionAlerts[session] = state
    if (state !== 'open') {
      await raise(
        'whatsapp_disconnected', 'critical',
        `انقطاع اتصال واتساب (${num.display_name || session})`,
        `رقم واتساب "${num.display_name || session}" غير متصل حالياً (الحالة: ${state}). الوكيل لا يستطيع إرسال أو استقبال الرسائل عبر هذا الرقم حتى تتم إعادة الربط.`,
        { state, session, whatsapp_number_id: num.id },
        num.company_id ?? company_id,
      )
    } else {
      // Confirmed reconnected — clear both alert types so the send-gate
      // circuit breaker can resume sending (see the resolveOpen comment
      // above for why delivery_failure is cleared alongside disconnected).
      await resolveOpen('whatsapp_disconnected', num.company_id ?? company_id)
      await resolveOpen('whatsapp_delivery_failure', num.company_id ?? company_id)
    }
  }
  result.connectionStates = connectionAlerts

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

  // 3) Message-freshness watchdog — independent of what WAHA's own session
  // state claims. 🔴 P0 PRODUCTION INCIDENT (2026-07-09/10): the session
  // state check above (#1) reported "open"/connected throughout a real ~25-
  // hour total inbound blackout, because "connected" only reflects WAHA's
  // own link to WhatsApp — a broken WEBHOOK from WAHA to this app (wrong/
  // stale secret, wrong URL, a WAHA-side config reset on reconnect) is a
  // completely different failure mode that check #1 structurally cannot
  // see. Root cause was a webhook-secret mismatch causing every event to be
  // silently discarded with a fabricated `{status:'ok'}` (now alerted on
  // separately — see waha-webhook/route.ts's webhook_auth_mismatch alert),
  // but ANY cause of "WAHA isn't calling us" (network issue, WAHA crash,
  // reverse-proxy misconfiguration) would look identical from here: zero
  // inbound messages arriving for hours, dashboard showing everything green.
  // This check doesn't care WHY — it only asks the one question that
  // actually matters: is real customer traffic still reaching our database?
  const FRESHNESS_THRESHOLD_HOURS = 4
  const { data: lastInbound } = await supabase
    .from('messages').select('created_at')
    .eq('direction', 'inbound').eq('channel', 'whatsapp')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const lastInboundAt = (lastInbound as { created_at?: string } | null)?.created_at
  const hoursSinceLastInbound = lastInboundAt
    ? (Date.now() - new Date(lastInboundAt).getTime()) / 3_600_000
    : null
  result.hoursSinceLastInbound = hoursSinceLastInbound !== null ? Number(hoursSinceLastInbound.toFixed(1)) : null

  if (hoursSinceLastInbound !== null && hoursSinceLastInbound > FRESHNESS_THRESHOLD_HOURS) {
    result.freshnessAlert = await raise(
      'whatsapp_no_inbound_traffic', 'critical',
      'انقطاع كامل — لا رسائل واردة من العملاء',
      `آخر رسالة واردة من عميل كانت قبل ${hoursSinceLastInbound.toFixed(1)} ساعة، رغم أن حالة الجلسة قد تظهر "متصلة". هذا يعني على الأغلب أن webhook واتساب لا يصل لنظامنا فعلياً — كل رسالة عميل خلال هذه الفترة قد تكون رُفضت بصمت. راجع إعداد الـ webhook بلوحة WAHA فوراً (الرابط ورأس التحقق X-Webhook-Secret).`,
      { hours_since_last_inbound: result.hoursSinceLastInbound, last_inbound_at: lastInboundAt ?? null },
    )
  } else {
    await resolveOpen('whatsapp_no_inbound_traffic', company_id)
  }

  log.info('whatsapp-health run', result)
  return NextResponse.json({ message: 'done', result })
}
