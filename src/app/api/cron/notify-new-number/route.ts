import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/notify-new-number')

// One-off: messages customers with open conversations from the NEW WhatsApp number
// so they know the new contact number. Skips paused customers + recently-notified ones.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Customers with an open debt, valid Saudi number, not paused
  const { data: debts } = await supabase
    .from('debts')
    .select('company_id, customer:customers(id, full_name, phone, whatsapp, ai_paused)')
    .not('status', 'in', '("settled","written_off")')
    .limit(500)

  const seen = new Set<string>()
  const targets: { company_id: string; id: string; name: string; phone: string }[] = []
  for (const d of debts ?? []) {
    const c: any = (d as any).customer
    if (!c || c.ai_paused) continue
    const phone = (c.whatsapp || c.phone || '').replace(/[^\d+]/g, '')
    if (!/^\+?9665\d{8}$/.test(phone)) continue
    if (seen.has(c.id)) continue
    seen.add(c.id)
    targets.push({ company_id: (d as any).company_id, id: c.id, name: c.full_name || '', phone })
  }

  const results = { candidates: targets.length, sent: 0, skipped: 0, failed: 0 }

  for (const t of targets) {
    // dedup: skip if we already sent the notice in the last 7 days
    const { data: prev } = await supabase
      .from('messages').select('id')
      .eq('customer_id', t.id).eq("metadata->>source", 'new_number_notice')
      .gte('sent_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(1).maybeSingle()
    if (prev) { results.skipped++; continue }

    const firstName = t.name.split(' ')[0] || ''
    const msg = `مرحباً ${firstName}، معك خالد من قسم التحصيل. هذا رقمنا الجديد للتواصل بخصوص ملفك. تقدر ترد علينا هنا مباشرة وبنكمل معك.`
    try {
      const r = await sendWhatsAppMessage({ to: t.phone, message: msg, company_id: t.company_id })
      await supabase.from('messages').insert({
        company_id: t.company_id, customer_id: t.id,
        channel: 'whatsapp', direction: 'outbound', content: msg,
        status: r.status === 'sent' ? 'sent' : 'failed', whatsapp_message_id: r.message_id || null,
        metadata: { sender: 'ai', action_type: 'reply', source: 'new_number_notice', error: r.error ?? null },
        sent_at: new Date().toISOString(),
      })
      if (r.status === 'sent') results.sent++; else results.failed++
    } catch (e) {
      log.error(`notify failed for ${t.id}`, e)
      results.failed++
    }
  }

  log.info('notify-new-number run', results)
  return NextResponse.json({ message: 'done', results })
}
