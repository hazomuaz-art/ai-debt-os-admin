import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { extractReceipt, extractReceiptFromPdf, extractReceiptFromText, type ReceiptData } from '@/lib/receipt-ocr'
import { recordAttribution } from '@/lib/revenue-attribution'
import { insertSystemAlert } from '@/lib/system-alerts'
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
 * trivial to fabricate — they're always recorded as "pending" /
 * "pending_verification" for a human to confirm against the bank statement.
 * Same for any attachment whose beneficiary reference (SADAD/account number
 * or IBAN) doesn't match what we hold for this debt — amount or OCR
 * confidence alone are never sufficient to auto-verify a payment.
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

  // 🔴 Real production bug this fixes (customer RAYMOND LASTRELLA
  // BLANCAFLOR / 4a47f571, 2026-07-09): this customer's entire conversation
  // was in English, and the main collector agent already mirrors that
  // correctly per-message — but this receipt-confirmation reply is a THIRD
  // separate code path that never looked at conversation language at all,
  // so a real 300 SAR payment got confirmed with an Arabic-only reply to a
  // customer who never once wrote a word of Arabic. Same fix as
  // document-classifier.ts / waha-webhook.ts's document ack path: look at
  // the customer's actual recent messages, since a receipt attachment
  // usually carries no caption text of its own to judge.
  const { data: recentForLang } = await svc
    .from('messages').select('content').eq('customer_id', args.customer_id).eq('direction', 'inbound')
    .order('sent_at', { ascending: false }).limit(10)
  const { isNonArabicConversation } = await import('@/lib/detect-language')
  const replyLang: 'ar' | 'en' = isNonArabicConversation((recentForLang ?? []).map((m: { content: string | null }) => m.content ?? '')) ? 'en' : 'ar'

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

  // Persist the original file the customer actually sent — previously this
  // was OCR'd then discarded forever, leaving nothing to show a human
  // reviewer or pull up later in a dispute/audit. Non-critical: a storage
  // failure never blocks recording the payment itself.
  const receiptPath = args.source === 'text' ? null : await uploadReceiptFile(svc, args)

  // Load the debt + the expected collection account (our beneficiary) so we can
  // actually MATCH the transfer instead of blindly trusting the amount.
  const { data: debt } = args.debt_id
    ? await svc.from('debts')
        .select('current_balance, currency, status, reference_number, account_number, creditor_name, portfolio_id, created_at, metadata')
        .eq('id', args.debt_id).maybeSingle()
    : { data: null as any }
  const d = (debt ?? {}) as Record<string, any>
  const balance = Number(d.current_balance ?? 0)
  const currency = d.currency ?? ocr.currency ?? 'SAR'

  const { data: accounts } = await svc.from('collection_accounts')
    .select('method_type, iban, account_name, bank_name, biller_code, biller_name, portfolio_id')
    .eq('company_id', args.company_id).eq('is_active', true)
  // Only ever match against an account explicitly configured for THIS
  // portfolio (or a company-wide default with no portfolio_id at all) —
  // never fall back to an unrelated portfolio's account just because one
  // happens to exist, which would silently "match" against the wrong
  // company's beneficiary.
  const acc = (accounts ?? []).find((a: any) => d.portfolio_id && a.portfolio_id === d.portfolio_id)
    ?? (accounts ?? []).find((a: any) => !a.portfolio_id) ?? null

  const digits = (s: any) => String(s ?? '').replace(/\D/g, '')
  const last4 = (s: any) => digits(s).slice(-4)
  const amount = Number(ocr.amount ?? 0)
  const amountOk = amount > 0 && amount <= balance * 1.2 + 1

  // The per-customer SADAD number (telecom: STC/Mobily/Zain) — the same
  // field ai-collector-agent.ts treats as the primary payment reference for
  // these portfolios. NOT "service/product number" (deliberately excluded —
  // it never appears on the actual customer-sent receipts).
  const extra = (d.metadata?.extra ?? {}) as Record<string, any>
  const pickExtra = (...keys: string[]) => keys.map(k => extra[k]).find(v => v != null && String(v).trim() !== '') ?? null
  const sadadNumber = pickExtra('sadad_number', 'رقم سداد', 'رقم السداد', 'sadad', 'biller_number')

  // Beneficiary matching — proves the money actually went to OUR account for
  // THIS specific customer/debt, never inferred from amount or OCR
  // confidence alone.
  //   - Telecom (STC/Mobily/Zain) & utilities/government: amount + (SADAD
  //     number OR account number OR invoice/reference number).
  //   - Insurance: amount + the company's approved IBAN.
  let beneficiary: 'match' | 'mismatch' | 'unknown' = 'unknown'
  const referenceHay = digits(`${ocr.invoice_number ?? ''} ${ocr.reference ?? ''}`)
  const referenceNeedles = [sadadNumber, d.account_number, d.reference_number, acc?.biller_code, acc?.biller_name]
    .map(digits).filter(n => n.length >= 4)
  const haveReferenceToCheck = !!(ocr.invoice_number || ocr.reference)

  if (acc?.iban) {
    // Bank-transfer creditor (insurance): match recipient IBAN tail and/or
    // beneficiary name against the company's approved account.
    const expect4 = last4(acc.iban)
    if (ocr.iban_last4 && expect4) beneficiary = last4(ocr.iban_last4) === expect4 ? 'match' : 'mismatch'
    else if (ocr.beneficiary_name && acc.account_name &&
             ocr.beneficiary_name.replace(/\s/g, '').includes(String(acc.account_name).split(' ')[0]))
      beneficiary = 'match'
    else beneficiary = 'unknown'
  } else if (referenceNeedles.length) {
    beneficiary = referenceNeedles.some(n => referenceHay.includes(n))
      ? 'match'
      : (haveReferenceToCheck ? 'mismatch' : 'unknown')
  }

  // Auto-confirm ONLY when: it's an actual attachment (never a typed-text
  // claim), the amount is sane, AND the beneficiary genuinely matches a real
  // reference we hold for this customer/debt. Amount alone is never enough,
  // and OCR confidence alone is never enough — an "unknown" beneficiary
  // (no checkable reference at all, or a clear mismatch) always falls to
  // pending_verification, regardless of how confident the OCR reading was.
  const autoVerify = args.source !== 'text' && amountOk && ocr.confidence >= 70 && beneficiary === 'match'

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
    await insertSystemAlert({
      company_id: args.company_id, severity: 'info', alert_type: 'payment_review',
      title: 'إيصال يحتاج مراجعة يدوية',
      message: `العميل ${args.customer_name ?? ''} أرسل ${srcLabel} لكن تعذّر قراءة المبلغ تلقائياً.`,
      metadata: { debt_id: args.debt_id, customer_id: args.customer_id, ocr, receipt_path: receiptPath },
    })
    await addTimeline(svc, args, 'payment', 'إيصال استُلم — يحتاج مراجعة يدوية (تعذّر قراءة المبلغ)', ocr)
    await replyAndLog(svc, args, replyLang === 'en'
      ? "Got your receipt, I'm verifying it now and will confirm shortly. Thank you."
      : 'استلمت إيصالك ووصلني، جاري التحقق منه وأأكد لك قريباً. شكراً.')
    return
  }

  const payDate = (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date)) ? ocr.date : new Date().toISOString().slice(0, 10)
  const { data: insertedPayment, error: paymentInsertErr } = await svc.from('payments').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    amount, currency,
    status: autoVerify ? 'completed' : 'pending',
    payment_date: payDate,
    verification_status: autoVerify ? 'verified' : 'pending_verification',
    ocr_data: ocr,
    receipt_url: receiptPath,
    notes: noteBits,
  }).select('id').single()
  // Real gap found during a full-system audit: not checked — a rejected
  // insert (constraint/RLS) meant a customer's verified payment could be
  // fully processed downstream (debt balance dropped, promise marked kept)
  // while the payments row itself silently never existed.
  if (paymentInsertErr) log.error('payment insert failed', { error: paymentInsertErr.message, debt_id: args.debt_id, amount })

  let reply: string
  if (autoVerify && args.debt_id) {
    // ── FULL PAYMENT CYCLE: debt + promises + timeline all updated ──
    const newBal = Math.max(0, balance - amount)
    const upd: Record<string, unknown> = { current_balance: newBal }
    if (newBal <= 0) upd.status = 'settled'
    else if (d.status === 'promised' || d.status === 'overdue') upd.status = 'active'
    // Real gap found during a full-system audit: the single most
    // financially-critical write in this whole pipeline (the debt balance
    // itself) was never checked — a rejected update would leave the debt's
    // real balance untouched while the payment row + promise + timeline all
    // proceeded as if the debt had been reduced/settled, silently
    // corrupting the customer's actual owed amount.
    const { error: debtUpdErr } = await svc.from('debts').update(upd).eq('id', args.debt_id)
    if (debtUpdErr) log.error('debt balance update failed after verified payment', { error: debtUpdErr.message, debt_id: args.debt_id, newBal })

    // An open promise is fully "kept" only if this payment actually closes
    // the debt — a partial payment against a full-amount promise is only
    // PARTIALLY honored, not kept. Previously this always wrote 'kept'
    // regardless of remaining balance, which would make "وعد بالسداد"
    // compliance reporting (the promises page's "نسبة الالتزام") count a
    // half-paid promise as fully honored.
    const promiseOutcome = newBal <= 0 ? 'kept' : 'partial'
    const promiseUpd: Record<string, unknown> = { status: promiseOutcome }
    if (promiseOutcome === 'kept') promiseUpd.fulfilled_at = new Date().toISOString()
    const { error: promiseUpdErr } = await svc.from('promises')
      .update(promiseUpd)
      .eq('company_id', args.company_id).eq('debt_id', args.debt_id).eq('status', 'pending')
    if (promiseUpdErr) log.error('failed to mark promise outcome', { error: promiseUpdErr.message, debt_id: args.debt_id, promiseOutcome })

    await addTimeline(svc, args, 'payment',
      `سداد مؤكَّد ${amount} ${currency}${newBal <= 0 ? ' — سُدّدت المديونية بالكامل' : ` — المتبقي ${newBal} ${currency}`} (${matchMeta.beneficiary})`, ocr)

    // Attribution: this is the AI confirming a real payment via OCR, with
    // no human collector involved at all — fully AI-driven. settlement vs
    // payment depends on whether the debt was actually closed by it.
    if (insertedPayment?.id) {
      const { count: msgCount } = await svc.from('messages').select('id', { count: 'exact', head: true })
        .eq('company_id', args.company_id).eq('customer_id', args.customer_id).eq('debt_id', args.debt_id)
      const daysToCollect = d.created_at
        ? Math.max(0, Math.round((Date.now() - new Date(d.created_at).getTime()) / 86_400_000))
        : undefined
      await recordAttribution({
        company_id: args.company_id,
        event_type: newBal <= 0 ? 'settlement' : 'payment',
        payment_id: insertedPayment.id,
        customer_id: args.customer_id,
        debt_id: args.debt_id,
        amount,
        primary_channel: 'ai_reply',
        primary_actor: 'ai',
        ai_assisted: true,
        portfolio_id: d.portfolio_id ?? undefined,
        touches_before_pay: msgCount ?? undefined,
        days_to_collect: daysToCollect,
      })
    }

    // Partial payment must still be followed up to get a date for the
    // REMAINDER (full amount, not a new multi-payment plan) — never an
    // installment/objection suggestion unless the customer raises that
    // idea themselves; this is just asking when the rest will be paid.
    reply = replyLang === 'en'
      ? (newBal <= 0
        ? `Receipt received and confirmed — ${amount} ${currency}. Your debt has been fully paid, thank you.`
        : `Receipt received and confirmed — ${amount} ${currency}. Remaining balance: ${newBal} ${currency} — when can you pay the rest?`)
      : (newBal <= 0
        ? `تم استلام إيصالك وتأكيد مبلغ ${amount} ${currency}. تم سداد المديونية بالكامل، شكراً لك.`
        : `تم استلام إيصالك وتأكيد مبلغ ${amount} ${currency}. المتبقي ${newBal} ${currency} — متى تقدر تسدد باقي المبلغ؟`)
  } else {
    // Match incomplete (beneficiary mismatch, unknown, or a typed-text
    // claim with no attachment to verify) → never auto-verified. Always
    // pending_verification + a payment_review alert + the same neutral
    // reply, regardless of which specific reason caused it.
    const reason = beneficiary === 'mismatch'
      ? 'بيانات المستفيد/الفاتورة في الإيصال لا تطابق حساب التحصيل'
      : args.source === 'text'
        ? 'مطالبة سداد نصية بدون مرفق — لا يمكن التحقق آلياً'
        : `لا يوجد رقم حساب/سداد/IBAN مطابق في الإيصال (ثقة القراءة ${ocr.confidence}%)`
    await insertSystemAlert({
      company_id: args.company_id, severity: beneficiary === 'mismatch' ? 'warning' : 'info',
      alert_type: 'payment_review', title: 'إيصال دفع يحتاج مراجعة',
      message: `العميل ${args.customer_name ?? ''}: ${srcLabel} بمبلغ ${amount} ${currency} — ${reason}.`,
      metadata: { debt_id: args.debt_id, customer_id: args.customer_id, ...matchMeta, ocr },
    })
    await addTimeline(svc, args, 'payment', `إيصال بمبلغ ${amount} ${currency} — ${reason}`, ocr)
    reply = replyLang === 'en'
      ? "Got your receipt, we're reviewing it against the account to confirm the details."
      : 'وصلنا الإيصال، وبنراجع مطابقته على الحساب ونتأكد من البيانات.'
  }

  await replyAndLog(svc, args, reply)
}

// Uploads the original receipt (image/PDF) to the private 'payment-receipts'
// bucket so it can be reviewed or pulled up later — previously discarded
// right after OCR. Returns the storage path (not a public URL — the bucket
// is private; a signed URL is generated on demand at download time) or null
// if the upload fails (never blocks recording the payment itself).
async function uploadReceiptFile(
  svc: ReturnType<typeof createServiceClient>,
  args: { company_id: string; customer_id: string; source: ReceiptSource; data: string },
): Promise<string | null> {
  try {
    const ext = args.source === 'pdf' ? 'pdf' : 'jpg'
    const contentType = args.source === 'pdf' ? 'application/pdf' : 'image/jpeg'
    const path = `${args.company_id}/${args.customer_id}/${Date.now()}.${ext}`
    const buffer = Buffer.from(args.data, 'base64')

    const { error } = await svc.storage.from('payment-receipts').upload(path, buffer, { contentType })
    if (error) {
      log.error('receipt upload failed', new Error(error.message))
      return null
    }
    return path
  } catch (e) {
    log.error('receipt upload failed', e as Error)
    return null
  }
}

// Adds a timeline entry so the customer page / history / dashboards reflect the
// receipt event immediately (not stuck only in the payments table).
async function addTimeline(
  svc: ReturnType<typeof createServiceClient>,
  args: { company_id: string; customer_id: string; debt_id: string | null },
  event_type: string, summary: string, ocr: ReceiptData,
): Promise<void> {
  try {
    const { error: teErr } = await svc.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type, channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: summary.slice(0, 200), detail: JSON.stringify(ocr).slice(0, 1000),
      occurred_at: new Date().toISOString(),
    })
    if (teErr) log.error('receipt timeline insert failed', teErr, { debt_id: args.debt_id })
  } catch (e) {
    log.error('receipt timeline insert failed', e as Error)
  }
}

async function replyAndLog(
  svc: ReturnType<typeof createServiceClient>,
  args: { company_id: string; customer_id: string; debt_id: string | null; phone: string },
  reply: string,
): Promise<void> {
  const wr = await sendWhatsAppMessage({ to: args.phone, message: reply, company_id: args.company_id, customer_id: args.customer_id })
  const { error: logErr } = await svc.from('messages').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    channel: 'whatsapp', direction: 'outbound', content: reply,
    status: wr.status === 'sent' ? 'sent' : 'failed',
    whatsapp_message_id: wr.message_id || null,
    metadata: { sender: 'ai', action_type: 'reply', source: 'receipt_verification' },
    sent_at: new Date().toISOString(),
  })
  if (logErr) log.error('receipt reply message log failed', { error: logErr.message, debt_id: args.debt_id })
}
