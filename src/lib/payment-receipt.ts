import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { extractReceipt, extractReceiptFromPdf, extractReceiptFromText, type ReceiptData } from '@/lib/receipt-ocr'
import { createLogger } from '@/lib/logger'

const log = createLogger('payment-receipt')

export type ReceiptSource = 'image' | 'pdf' | 'text'

/**
 * Shared receipt-verification pipeline, usable from any WhatsApp gateway
 * webhook (WAHA). Reads a payment proof sent by the customer
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

  const srcLabel = args.source === 'image' ? 'صورة' : args.source === 'pdf' ? 'PDF' : 'نص'

  let ocr: ReceiptData | null
  if (args.source === 'image') ocr = await extractReceipt(args.data)
  else if (args.source === 'pdf') ocr = await extractReceiptFromPdf(args.data)
  else ocr = await extractReceiptFromText(args.data)

  // Genuinely not a receipt (e.g. a random photo) → let the agent handle it.
  if (!ocr || !ocr.is_receipt) {
    log.info('not recognized as a receipt — leaving for agent/human', { source: args.source, customer_id: args.customer_id })
    return
  }

  // Load the debt + the expected collection account (our beneficiary) so we can
  // actually MATCH the transfer instead of blindly trusting the amount.
  const { data: debt } = args.debt_id
    ? await svc.from('debts')
        .select('current_balance, currency, status, reference_number, account_number, creditor_name, portfolio_id')
        .eq('id', args.debt_id).maybeSingle()
    : { data: null as any }
  const d = (debt ?? {}) as Record<string, any>
  const balance = Number(d.current_balance ?? 0)
  const currency = d.currency ?? ocr.currency ?? 'SAR'

  const { data: accounts } = await svc.from('collection_accounts')
    .select('method_type, iban, account_name, bank_name, biller_code, biller_name, portfolio_id')
    .eq('company_id', args.company_id).eq('is_active', true)
  const acc = (accounts ?? []).find((a: any) => d.portfolio_id && a.portfolio_id === d.portfolio_id)
    ?? (accounts ?? []).find((a: any) => !a.portfolio_id) ?? (accounts ?? [])[0] ?? null

  const digits = (s: any) => String(s ?? '').replace(/\D/g, '')
  const last4 = (s: any) => digits(s).slice(-4)
  const amount = Number(ocr.amount ?? 0)
  const amountOk = amount > 0 && amount <= balance * 1.2 + 1

  // Beneficiary / invoice matching — proves the money went to US.
  let beneficiary: 'match' | 'mismatch' | 'unknown' = 'unknown'
  if (acc?.method_type === 'sadad_biller' && acc?.biller_code) {
    // Invoice/SADAD-based creditor (e.g. telecom/utility): the bill or biller
    // number on the receipt must reference our biller / the debt account.
    const hay = `${ocr.invoice_number ?? ''} ${ocr.reference ?? ''} ${ocr.beneficiary_name ?? ''}`
    const needles = [acc.biller_code, acc.biller_name, d.reference_number, d.account_number]
      .map(digits).filter(n => n.length >= 4)
    const haveAny = !!(ocr.invoice_number || ocr.reference)
    beneficiary = needles.some(n => digits(hay).includes(n)) ? 'match' : (haveAny ? 'mismatch' : 'unknown')
  } else if (acc?.iban) {
    // Bank-transfer creditor (e.g. insurance): match recipient IBAN tail and/or
    // beneficiary name against our account.
    const expect4 = last4(acc.iban)
    if (ocr.iban_last4 && expect4) beneficiary = last4(ocr.iban_last4) === expect4 ? 'match' : 'mismatch'
    else if (ocr.beneficiary_name && acc.account_name &&
             ocr.beneficiary_name.replace(/\s/g, '').includes(String(acc.account_name).split(' ')[0]))
      beneficiary = 'match'
    else beneficiary = 'unknown'
  }

  // Auto-confirm only image/PDF receipts that are a sane amount AND either match
  // our beneficiary, or (when we have no account to check against) are very high
  // confidence. A clear beneficiary MISMATCH is never auto-confirmed.
  const autoVerify = args.source !== 'text' && amountOk && ocr.confidence >= 70 &&
    (beneficiary === 'match' || (beneficiary === 'unknown' && ocr.confidence >= 85))

  const matchMeta = { beneficiary, amountOk, expected_balance: balance, source: args.source }
  const noteBits = [
    `إيصال عبر الواتساب (${srcLabel})`,
    ocr.reference ? `مرجع: ${ocr.reference}` : '',
    ocr.invoice_number ? `فاتورة: ${ocr.invoice_number}` : '',
    ocr.iban_last4 ? `آيبان٤: ${ocr.iban_last4}` : '',
    ocr.beneficiary_name ? `المستفيد: ${ocr.beneficiary_name}` : '',
    `مطابقة المستفيد: ${beneficiary}`,
  ].filter(Boolean).join(' — ')

  // No readable amount (e.g. scanned image-only PDF) → flag for review, never drop.
  if (!amount) {
    await svc.from('system_alerts').insert({
      company_id: args.company_id, severity: 'info', alert_type: 'payment_review',
      title: 'إيصال يحتاج مراجعة يدوية',
      message: `العميل ${args.customer_name ?? ''} أرسل ${srcLabel} لكن تعذّر قراءة المبلغ تلقائياً.`,
      metadata: { debt_id: args.debt_id, customer_id: args.customer_id, ocr }, is_resolved: false,
    })
    await addTimeline(svc, args, 'payment', 'إيصال استُلم — يحتاج مراجعة يدوية (تعذّر قراءة المبلغ)', ocr)
    await replyAndLog(svc, args, 'استلمت إيصالك ووصلني، جاري التحقق منه وأأكد لك قريباً. شكراً.')
    return
  }

  const payDate = (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date)) ? ocr.date : new Date().toISOString().slice(0, 10)
  await svc.from('payments').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    amount, currency,
    status: autoVerify ? 'completed' : 'pending',
    payment_date: payDate,
    verification_status: autoVerify ? 'verified' : 'pending',
    ocr_data: ocr,
    notes: noteBits,
  })

  let reply: string
  if (autoVerify && args.debt_id) {
    // ── FULL PAYMENT CYCLE: debt + promises + timeline all updated ──
    const newBal = Math.max(0, balance - amount)
    const upd: Record<string, unknown> = { current_balance: newBal }
    if (newBal <= 0) upd.status = 'settled'
    else if (d.status === 'promised' || d.status === 'overdue') upd.status = 'active'
    await svc.from('debts').update(upd).eq('id', args.debt_id)

    // Any open promise is now kept → mark fulfilled so the agent stops chasing it.
    await svc.from('promises')
      .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      .eq('company_id', args.company_id).eq('debt_id', args.debt_id).eq('status', 'pending')

    await addTimeline(svc, args, 'payment',
      `سداد مؤكَّد ${amount} ${currency}${newBal <= 0 ? ' — سُدّدت المديونية بالكامل' : ` — المتبقي ${newBal} ${currency}`} (${matchMeta.beneficiary})`, ocr)

    reply = `تم استلام إيصالك وتأكيد مبلغ ${amount} ${currency}. ${newBal <= 0 ? 'تم سداد المديونية بالكامل، شكراً لك.' : `المتبقي ${newBal} ${currency}.`}`
  } else {
    const reason = beneficiary === 'mismatch'
      ? 'بيانات المستفيد/الفاتورة في الإيصال لا تطابق حساب التحصيل'
      : `بحاجة مراجعة (ثقة ${ocr.confidence}%)`
    await svc.from('system_alerts').insert({
      company_id: args.company_id, severity: beneficiary === 'mismatch' ? 'warning' : 'info',
      alert_type: 'payment_review', title: 'إيصال دفع يحتاج مراجعة',
      message: `العميل ${args.customer_name ?? ''}: ${srcLabel} بمبلغ ${amount} ${currency} — ${reason}.`,
      metadata: { debt_id: args.debt_id, customer_id: args.customer_id, ...matchMeta, ocr }, is_resolved: false,
    })
    await addTimeline(svc, args, 'payment', `إيصال بمبلغ ${amount} ${currency} — ${reason}`, ocr)
    reply = beneficiary === 'mismatch'
      ? 'استلمت إيصالك، بس يبدو إن التحويل لجهة مختلفة. نراجعه ونأكد لك — لا داعي لإعادة الإرسال.'
      : 'تم استلام إيصالك ووصلني، جاري التحقق وسأؤكد لك قريباً. شكراً.'
  }

  await replyAndLog(svc, args, reply)
}

// Adds a timeline entry so the customer page / history / dashboards reflect the
// receipt event immediately (not stuck only in the payments table).
async function addTimeline(
  svc: ReturnType<typeof createServiceClient>,
  args: { company_id: string; customer_id: string; debt_id: string | null },
  event_type: string, summary: string, ocr: ReceiptData,
): Promise<void> {
  try {
    await svc.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type, channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: summary.slice(0, 200), detail: JSON.stringify(ocr).slice(0, 1000),
      occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    log.error('receipt timeline insert failed', e as Error)
  }
}

async function replyAndLog(
  svc: ReturnType<typeof createServiceClient>,
  args: { company_id: string; customer_id: string; debt_id: string | null; phone: string },
  reply: string,
): Promise<void> {
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
