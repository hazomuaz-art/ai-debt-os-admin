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
  confidence: number // 0-100
}

// Reads a bank-transfer / payment receipt image and extracts structured data.
// Uses GPT-5.5 vision via OpenRouter.
export async function extractReceipt(imageBase64: string): Promise<ReceiptData | null> {
  const empty: ReceiptData = {
    is_receipt: false, amount: null, currency: null, date: null,
    sender_name: null, bank: null, reference: null, iban_last4: null, confidence: 0,
  }
  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return empty

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
  })
  const model = process.env.OPENROUTER_API_KEY ? 'openai/gpt-5.5' : 'gpt-4o'
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`

  const prompt = `حلّل هذه الصورة. هل هي إيصال/سند تحويل بنكي أو دفع؟ استخرج البيانات وأعد JSON فقط بهذا الشكل بدون أي نص آخر:
{"is_receipt": true|false, "amount": <رقم أو null>, "currency": "SAR|USD|...", "date": "YYYY-MM-DD أو null", "sender_name": "اسم المُحوِّل أو null", "bank": "اسم البنك أو null", "reference": "الرقم المرجعي أو null", "iban_last4": "آخر 4 أرقام من الآيبان المستلِم أو null", "confidence": <0-100>}
إن لم تكن إيصالاً، أعد is_receipt=false والباقي null.`

  try {
    const res = await client.chat.completions.create({
      model,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ] as any,
        },
      ],
    })
    const raw = res.choices[0]?.message?.content ?? ''
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
      confidence: Number(parsed.confidence) || 0,
    }
  } catch (err: any) {
    log.error('receipt OCR failed', { error: String(err?.message ?? err) })
    return empty
  }
}
