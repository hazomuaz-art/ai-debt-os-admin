import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'

const log = createLogger('receipt-ocr')

export type ReceiptData = {
  is_receipt: boolean
  amount: number | null
  currency: string | null
  date: string | null
  sender_name: string | null
  bank: string | null
  reference: string | null
  iban_last4: string | null
  // Recipient/beneficiary of the transfer (the party that received the money) —
  // used to verify the payment actually went to OUR collection account.
  beneficiary_name: string | null
  // For SADAD / bill-based creditors: the invoice / bill / SADAD number paid.
  invoice_number: string | null
  confidence: number // 0-100
}

const EMPTY: ReceiptData = {
  is_receipt: false, amount: null, currency: null, date: null,
  sender_name: null, bank: null, reference: null, iban_last4: null,
  beneficiary_name: null, invoice_number: null, confidence: 0,
}

function getClient(): OpenAI | null {
  if (!process.env.OPENROUTER_API_KEY) return null
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })
}

const visionModel = () => 'anthropic/claude-sonnet-4'
const textModel = () => 'anthropic/claude-sonnet-4'

const PROMPT_INSTRUCTIONS = `هل هذا إيصال/سند تحويل بنكي أو سداد فاتورة أو دفع؟ استخرج كل البيانات الممكنة وأعد JSON فقط بهذا الشكل بدون أي نص آخر:
{"is_receipt": true|false, "amount": <رقم أو null>, "currency": "SAR|USD|...", "date": "YYYY-MM-DD أو null", "sender_name": "اسم المُحوِّل/الدافع أو null", "bank": "اسم البنك أو null", "reference": "الرقم المرجعي للعملية أو null", "iban_last4": "آخر 4 أرقام من آيبان المستلِم أو null", "beneficiary_name": "اسم المستفيد/المستلِم للمبلغ أو null", "invoice_number": "رقم الفاتورة أو رقم السداد/المفوتر أو null", "confidence": <0-100>}
استخرج beneficiary_name و invoice_number إن وُجدا (مهم للتحقق). إن لم يكن إيصالاً، أعد is_receipt=false والباقي null.`

function parseReceiptJson(raw: string): ReceiptData {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const first = s.indexOf('{'); const last = s.lastIndexOf('}')
  const parsed = JSON.parse(first !== -1 && last > first ? s.slice(first, last + 1) : s)
  return {
    is_receipt: !!parsed.is_receipt,
    amount: parsed.amount != null && !Number.isNaN(Number(parsed.amount)) ? Number(parsed.amount) : null,
    currency: parsed.currency ?? null,
    date: parsed.date ?? null,
    sender_name: parsed.sender_name ?? null,
    bank: parsed.bank ?? null,
    reference: parsed.reference ?? null,
    iban_last4: parsed.iban_last4 ?? null,
    beneficiary_name: parsed.beneficiary_name ?? null,
    invoice_number: parsed.invoice_number != null ? String(parsed.invoice_number) : null,
    confidence: Number(parsed.confidence) || 0,
  }
}

// Reads a bank-transfer / payment receipt IMAGE and extracts structured data.
export async function extractReceipt(imageBase64: string): Promise<ReceiptData | null> {
  const client = getClient()
  if (!client) return EMPTY

  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`

  try {
    const res = await client.chat.completions.create({
      model: visionModel(),
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `حلّل هذه الصورة. ${PROMPT_INSTRUCTIONS}` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] as any,
        },
      ],
    })
    return parseReceiptJson(res.choices[0]?.message?.content ?? '')
  } catch (err: any) {
    log.error('receipt OCR (image) failed', { error: String(err?.stack || err?.message || err) })
    return EMPTY
  }
}

// Reads receipt data from plain TEXT (extracted from a PDF, or pasted by the
// customer directly in the chat — e.g. a copied bank transfer confirmation).
export async function extractReceiptFromText(text: string): Promise<ReceiptData | null> {
  const client = getClient()
  if (!client) return EMPTY
  if (!text || text.trim().length < 5) return EMPTY

  try {
    const res = await client.chat.completions.create({
      model: textModel(),
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'user', content: `هذا نص مُستخرَج من رسالة/مستند أرسله عميل. ${PROMPT_INSTRUCTIONS}\n\nالنص:\n${text.slice(0, 4000)}` },
      ],
    })
    return parseReceiptJson(res.choices[0]?.message?.content ?? '')
  } catch (err: any) {
    log.error('receipt OCR (text) failed', { error: String(err?.stack || err?.message || err) })
    return EMPTY
  }
}

// Reads a PDF receipt (bank statement / transfer confirmation). Extracts the
// embedded text first (works for digitally-generated PDFs, which covers the
// vast majority of bank receipts) and runs it through the text extractor.
// Scanned/image-only PDFs will yield empty text and fall through to "needs
// human review" rather than being silently dropped.
export async function extractReceiptFromPdf(pdfBase64: string): Promise<ReceiptData | null> {
  const buf = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64')
  let textResult: ReceiptData | null = null

  // 1) Try the embedded text layer (covers digitally-generated bank receipts).
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const { text } = await parser.getText()
    await parser.destroy()
    // pdf-parse v2 injects page markers like "-- 1 of 2 --"; strip them before
    // judging whether there's REAL text (an image-only PDF yields only markers).
    const meaningful = String(text ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').replace(/\s+/g, ' ').trim()
    if (meaningful.length >= 15) {
      textResult = await extractReceiptFromText(meaningful)
      if (textResult && textResult.is_receipt && textResult.amount) return textResult
    }
  } catch (err: any) {
    log.error('receipt OCR (pdf text) failed', { error: String(err?.stack || err?.message || err) })
  }

  // 2) No usable text layer → the PDF is a scanned image / bank-app export.
  // Render the first page to a PNG and run the SAME vision OCR used for images.
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const shot = await parser.getScreenshot({ scale: 2, first: 1 })
    await parser.destroy()
    const page = shot?.pages?.[0]
    const dataUrl: string | null = page?.dataUrl
      || (page?.data ? `data:image/png;base64,${Buffer.from(page.data).toString('base64')}` : null)
    if (dataUrl) {
      const vision = await extractReceipt(dataUrl)
      if (vision) return vision // trust the vision verdict (receipt or not)
    }
  } catch (err: any) {
    log.error('receipt OCR (pdf render) failed', { error: String(err?.stack || err?.message || err) })
  }

  // Couldn't read text OR render → don't drop silently; flag for human review.
  return textResult ?? { ...EMPTY, is_receipt: true, confidence: 0 }
}
