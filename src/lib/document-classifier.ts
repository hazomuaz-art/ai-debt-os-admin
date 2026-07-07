import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'

const log = createLogger('document-classifier')

// Closed set the user explicitly named — never let the model invent a type
// outside this list (mirrors the same closed-set-enforcement pattern used in
// debt-status-classifier.ts).
export const DOCUMENT_TYPES = [
  'receipt', 'account_statement', 'letter', 'court_judgment',
  'proof_of_payment', 'debt_waiver', 'id_document', 'other',
] as const
export type DocumentType = typeof DOCUMENT_TYPES[number]

// Document types where the content may affect the debt itself (waiver,
// payment, a court ruling, an official letter) — these always require a
// human admin to actually review before anything changes, per the user's
// explicit mandate. "receipt" is excluded here since it has its own
// dedicated OCR + auto-verification pipeline (payment-receipt.ts).
const REVIEW_REQUIRED: ReadonlySet<DocumentType> = new Set([
  'account_statement', 'letter', 'court_judgment', 'proof_of_payment', 'debt_waiver',
])

export type DocumentClassification = {
  doc_type: DocumentType
  summary: string
  confidence: number // 0-100
  needs_admin_review: boolean
}

function getClient(): OpenAI | null {
  if (!process.env.OPENROUTER_API_KEY) return null
  return new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })
}

const FALLBACK: DocumentClassification = {
  doc_type: 'other', summary: '', confidence: 0, needs_admin_review: true,
}

const PROMPT = `أنت مصنّف مستندات لنظام تحصيل ديون. حلّل المرفق المُرسَل من العميل عبر واتساب وحدد نوعه الحقيقي من هذه القائمة المغلقة فقط:
- receipt: إيصال/سند تحويل بنكي أو سداد فاتورة (دفعة فعلية)
- account_statement: كشف حساب بنكي أو كشف مديونية
- letter: خطاب رسمي (من جهة حكومية، بنك، محامي، إلخ)
- court_judgment: حكم أو مستند قضائي/محكمة
- proof_of_payment: إثبات سداد لا يحمل شكل إيصال بنكي رسمي (لقطة شاشة تطبيق، تأكيد نصي مصوَّر)
- debt_waiver: مستند يثبت إسقاط/إعفاء من المديونية جزئياً أو كلياً
- id_document: هوية وطنية/إقامة/جواز سفر
- other: أي شيء آخر لا ينطبق عليه ما سبق (صورة عشوائية، سكرين شات غير متعلق، إلخ)

أعد JSON فقط بالشكل التالي بدون أي نص إضافي:
{"doc_type": "أحد القيم أعلاه بالضبط", "summary": "وصف من جملة أو جملتين لمحتوى المستند الفعلي بالعربية", "confidence": <0-100>}`

function parse(raw: string): { doc_type: string; summary: string; confidence: number } | null {
  try {
    const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const first = s.indexOf('{'); const last = s.lastIndexOf('}')
    return JSON.parse(first !== -1 && last > first ? s.slice(first, last + 1) : s)
  } catch { return null }
}

function toResult(parsed: { doc_type: string; summary: string; confidence: number } | null): DocumentClassification {
  if (!parsed) return FALLBACK
  const doc_type = (DOCUMENT_TYPES as readonly string[]).includes(parsed.doc_type)
    ? parsed.doc_type as DocumentType
    : 'other'
  return {
    doc_type,
    summary: String(parsed.summary ?? '').slice(0, 500),
    confidence: Number(parsed.confidence) || 0,
    needs_admin_review: REVIEW_REQUIRED.has(doc_type),
  }
}

// Classifies an inbound image attachment. Never assumes what it is —
// analyzes the actual visual content first via a vision-capable model.
export async function classifyDocumentImage(imageBase64: string): Promise<DocumentClassification> {
  const client = getClient()
  if (!client) return FALLBACK
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
  try {
    const res = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ] as any,
      }],
    })
    return toResult(parse(res.choices[0]?.message?.content ?? ''))
  } catch (err) {
    log.error('image classification failed', err as Error)
    return FALLBACK
  }
}

async function classifyDocumentText(text: string): Promise<DocumentClassification> {
  const client = getClient()
  if (!client) return FALLBACK
  try {
    const res = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `${PROMPT}\n\nنص المستند:\n${text.slice(0, 4000)}` }],
    })
    return toResult(parse(res.choices[0]?.message?.content ?? ''))
  } catch (err) {
    log.error('text classification failed', err as Error)
    return FALLBACK
  }
}

// Classifies an inbound PDF attachment — tries the embedded text layer first
// (digitally-generated documents), falling back to rendering page 1 as an
// image and running the same vision classifier used for photos (covers
// scanned/image-only PDFs, same approach as receipt-ocr.ts).
export async function classifyDocumentPdf(pdfBase64: string): Promise<DocumentClassification> {
  const buf = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64')
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const { text } = await parser.getText()
    await parser.destroy()
    const meaningful = String(text ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').replace(/\s+/g, ' ').trim()
    if (meaningful.length >= 15) return await classifyDocumentText(meaningful)
  } catch (err) {
    log.error('pdf text classification failed', err as Error)
  }
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const shot = await parser.getScreenshot({ scale: 2, first: 1 })
    await parser.destroy()
    const page = shot?.pages?.[0]
    const dataUrl: string | null = page?.dataUrl
      || (page?.data ? `data:image/png;base64,${Buffer.from(page.data).toString('base64')}` : null)
    if (dataUrl) return await classifyDocumentImage(dataUrl)
  } catch (err) {
    log.error('pdf render classification failed', err as Error)
  }
  // Couldn't read text OR render — never assume a type; flag for review.
  return { ...FALLBACK, needs_admin_review: true }
}
