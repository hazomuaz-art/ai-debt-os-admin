import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { extractReceipt, extractReceiptFromPdf, extractReceiptFromText, type ReceiptData } from '@/lib/receipt-ocr'
import { createLogger } from '@/lib/logger'

const log = createLogger('payment-receipt')

export type ReceiptSource = 'image' | 'pdf' | 'text'

/**
 * Shared receipt-verification pipeline, usable from any WhatsApp gateway
 * webhook (WAHA, Evolution, ...). Reads a payment proof sent by the customer
 * — as an image, a PDF document, or plain text — extracts amount/date/etc,
 * and either auto-confirms the payment or flags it for admin review.
 *
 * Text-only claims (no attachment) are NEVER auto-verified, since they're
 * trivial to fabricate — they're always recorded as "pending" for a human
 * to confirm against the bank statement.
 */
export async function processInboundReceipt(args: {
  company_id: string
  customer_id: string
  customer_name?: string | null
  debt_id: string | null
  phone: string
  source: ReceiptSource
  data: string // base64 (image/pdf) or raw text
}): Promise<void> {
  const svc = createServiceClient()

  let ocr: ReceiptData | null
  if (args.source === 'image') ocr = await extractReceipt(args.data)
  else if (args.source === 'pdf') ocr = await extractReceiptFromPdf(args.data)
  else ocr = await extractReceiptFromText(args.data)

  if (!ocr || !ocr.is_receipt || !ocr.amount) {
    log.info('not recognized as a receipt — leaving for agent/human', { source: args.source, customer_id: args.customer_id })
    return
  }

  const { data: debt } = args.debt_id
    ? await svc.from('debts').select('current_balance, currency').eq('id', args.debt_id).maybeSingle()
    : { data: null }
  const balance = Number((debt as { current_balance?: number } | null)?.current_balance ?? 0)
  const currency = (debt as { currency?: string } | null)?.currency ?? ocr.currency ?? 'SAR'

  // Text claims are never auto-verified — only image/PDF receipts with high
  // OCR confidence and a sane amount can be confirmed automatically.
  const autoVerify = args.source !== 'text' && ocr.confidence >= 70 && ocr.amount > 0 && ocr.amount <= balance * 1.2 + 1

  await svc.from('payments').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    amount: ocr.amount, currency,
    status: autoVerify ? 'completed' : 'pending',
    payment_date: (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date)) ? ocr.date : new Date().toISOString().slice(0, 10),
    verification_status: autoVerify ? 'verified' : 'pending',
    ocr_data: ocr,
    notes: `إيصال عبر الواتساب (${args.source === 'image' ? 'صورة' : args.source === 'pdf' ? 'PDF' : 'نص'})`,
  })

  let reply: string
  if (autoVerify && args.debt_id) {
    const newBal = Math.max(0, balance - ocr.amount)
    const upd: Record<string, unknown> = { current_balance: newBal }
    if (newBal <= 0) upd.status = 'settled'
    await svc.from('debts').update(upd).eq('id', args.debt_id)
    reply = `تم استلام إيصالك وتأكيد مبلغ ${ocr.amount} ${currency}. ${newBal <= 0 ? 'تم سداد المديونية بالكامل، شكراً لك.' : `المتبقي ${newBal} ${currency}.`}`
  } else {
    reply = 'استلمنا إيصالك، جاري التحقق منه وسنؤكد لك قريباً. شكراً.'
    await svc.from('system_alerts').insert({
      company_id: args.company_id, severity: 'info', alert_type: 'payment_review',
      title: 'إيصال دفع يحتاج مراجعة',
      message: `العميل ${args.customer_name ?? ''} أرسل ${args.source === 'image' ? 'صورة' : args.source === 'pdf' ? 'PDF' : 'نص'} بمبلغ ${ocr.amount ?? '؟'} ${currency} (ثقة ${ocr.confidence}%)`,
      metadata: { debt_id: args.debt_id, customer_id: args.customer_id }, is_resolved: false,
    })
  }

  const wr = await sendWhatsAppMessage({ to: args.phone, message: reply, company_id: args.company_id })
  await svc.from('messages').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    channel: 'whatsapp', direction: 'outbound', content: reply,
    status: wr.status === 'sent' ? 'sent' : 'failed',
    whatsapp_message_id: wr.message_id || null,
    metadata: { sender: 'ai', action_type: 'reply', source: 'receipt_verification' },
    sent_at: new Date().toISOString(),
  })
}
