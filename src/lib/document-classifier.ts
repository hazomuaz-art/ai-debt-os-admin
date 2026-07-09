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

هذا الحقل "summary" يُرسَل للعميل مباشرة كجزء من رد واتساب — لازم يكون جملة واحدة طبيعية بصيغة محادثة بشرية عادية، وليس تقريراً تحليلياً. لا تكتبه بصيغة "الصورة تُظهر..." أو "لا تحتوي على..." أو أي أسلوب وصفي/تحليلي بارد — اكتبه كأنك تخبر العميل مباشرة بمحتوى ما أرسله بجملة قصيرة طبيعية (مثال: "استلمت إيصال تحويل بنكي بمبلغ 500 ريال" أو "استلمت صورة لمحل تجاري، ما فيها أي مستند متعلق بالدين"). إذا المرفق غير متعلق بالمديونية إطلاقاً، وضّح هذا بجملة بسيطة مباشرة بدل أسلوب تقرير.

أعد JSON فقط بالشكل التالي بدون أي نص إضافي:
{"doc_type": "أحد القيم أعلاه بالضبط", "summary": "جملة واحدة طبيعية جاهزة للإرسال المباشر للعميل، بالعربية", "confidence": <0-100>}`

// 🔴 Real production bug this fixes (customer RAYMOND LASTRELLA BLANCAFLOR /
// 4a47f571, 2026-07-09): this customer's entire conversation was in
// English — the main collector agent (ai-collector-agent.ts) already
// mirrors the customer's language correctly — but this classifier's summary
// was ALWAYS generated in Arabic regardless, because nothing here ever knew
// what language the conversation was actually in. The customer got an
// otherwise-improved, natural-sounding summary that was still in the wrong
// language entirely. `lang` lets the caller (which reads the real recent
// conversation history) tell this classifier to write the summary in
// English instead, mirroring the same per-conversation language decision
// the main agent already makes.
const ENGLISH_SUMMARY_INSTRUCTION = '\n\n🔴 هذا العميل يتواصل بالإنجليزية في محادثته الحالية بالكامل — اكتب حقل "summary" بالإنجليزية فقط، بنفس الأسلوب الطبيعي المباشر أعلاه، لا بالعربية.'

function buildPrompt(lang: 'ar' | 'en'): string {
  return lang === 'en' ? PROMPT + ENGLISH_SUMMARY_INSTRUCTION : PROMPT
}

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
export async function classifyDocumentImage(imageBase64: string, lang: 'ar' | 'en' = 'ar'): Promise<DocumentClassification> {
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
          { type: 'text', text: buildPrompt(lang) },
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

async function classifyDocumentText(text: string, lang: 'ar' | 'en' = 'ar'): Promise<DocumentClassification> {
  const client = getClient()
  if (!client) return FALLBACK
  try {
    const res = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `${buildPrompt(lang)}\n\nنص المستند:\n${text.slice(0, 4000)}` }],
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
export async function classifyDocumentPdf(pdfBase64: string, lang: 'ar' | 'en' = 'ar'): Promise<DocumentClassification> {
  const buf = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64')
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const { text } = await parser.getText()
    await parser.destroy()
    const meaningful = String(text ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '').replace(/\s+/g, ' ').trim()
    if (meaningful.length >= 15) return await classifyDocumentText(meaningful, lang)
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
    if (dataUrl) return await classifyDocumentImage(dataUrl, lang)
  } catch (err) {
    log.error('pdf render classification failed', err as Error)
  }
  // Couldn't read text OR render — never assume a type; flag for review.
  return { ...FALLBACK, needs_admin_review: true }
}
