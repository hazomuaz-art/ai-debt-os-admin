import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getOpenRouterBalance } from '@/lib/provider-balance'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/balance-check')

const WARNING_USD  = Number(process.env.BALANCE_ALERT_WARNING_USD ?? 5)
const CRITICAL_USD = Number(process.env.BALANCE_ALERT_CRITICAL_USD ?? 1)
const ALERT_PHONE  = process.env.BALANCE_ALERT_PHONE

/**
 * Periodic check of the real OpenRouter balance that powers every AI call
 * in the app. Raises a dashboard alert + sends a WhatsApp message to the IT
 * contact before the credit runs out and the AI agent starts failing.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    // Enforced whenever a secret is actually configured, regardless of
    // NODE_ENV — the old check only enforced in NODE_ENV==='production',
    // leaving every cron route open with zero auth on any other deploy target.
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const balance = await getOpenRouterBalance()
  if (!balance) return NextResponse.json({ message: 'could not fetch balance' }, { status: 200 })

  const supabase = createServiceClient()
  const result: Record<string, unknown> = { ...balance }

  const raise = async (alert_type: string, severity: string, title: string, message: string) => {
    const { data: existing } = await supabase
      .from('system_alerts').select('id').eq('alert_type', alert_type).eq('is_resolved', false)
      .is('company_id', null).limit(1).maybeSingle()
    if (existing) return false
    await supabase.from('system_alerts').insert({
      company_id: null, alert_type, severity, title, message,
      metadata: balance, is_read: false, is_resolved: false,
    })
    if (ALERT_PHONE) {
      const wr = await sendWhatsAppMessage({ to: ALERT_PHONE, message: `⚠️ ${title}\n${message}` })
      if (wr.status !== 'sent') log.error('balance alert WhatsApp send failed', undefined, { error: wr.error })
    }
    return true
  }

  // Once the balance recovers (top-up), auto-resolve old alerts so the next
  // drop raises a fresh one instead of staying silently dismissed.
  if (balance.remaining > WARNING_USD) {
    await supabase.from('system_alerts')
      .update({ is_resolved: true, resolved_at: new Date().toISOString() })
      .in('alert_type', ['ai_balance_warning', 'ai_balance_critical'])
      .eq('is_resolved', false).is('company_id', null)
  }

  if (balance.remaining <= CRITICAL_USD) {
    result.criticalAlert = await raise(
      'ai_balance_critical', 'critical',
      'رصيد الذكاء الاصطناعي على وشك النفاد',
      `المتبقي ${balance.remaining.toFixed(2)}$ فقط من أصل ${balance.total_credits}$. الوكيل سيتوقف عن الرد فعلياً عند نفاد الرصيد. يجب الشحن فوراً.`,
    )
  } else if (balance.remaining <= WARNING_USD) {
    result.warningAlert = await raise(
      'ai_balance_warning', 'warning',
      'رصيد الذكاء الاصطناعي منخفض',
      `المتبقي ${balance.remaining.toFixed(2)}$ من أصل ${balance.total_credits}$. يُنصح بالشحن قريباً قبل توقف الوكيل.`,
    )
  }

  log.info('balance-check run', result)
  return NextResponse.json({ message: 'done', result })
}
