import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { withAuth, errors } from '@/lib/api'
import { resolveResponse, storeCache } from '@/lib/smart-response'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: {
      message?: string
      language?: 'ar' | 'en'
      customer_id?: string
      debt_id?: string
    }

    try {
      body = await req.json()
    } catch {
      return errors.badRequest('Invalid JSON')
    }

    if (!body.message) return errors.badRequest('message required')

    const language = body.language ?? 'ar'
    const companyId = ctx.profile.company_id

    let debtContext: Awaited<ReturnType<typeof buildCustomerDebtContext>> | null = null

    if (body.customer_id) {
      debtContext = await buildCustomerDebtContext({
        company_id: companyId,
        customer_id: body.customer_id,
        debt_id: body.debt_id ?? null,
      })
    }

    const hasContext = !!debtContext?.customer || !!debtContext?.debt

    const resolved = !hasContext
      ? await resolveResponse({
          companyId,
          message: body.message,
          language,
        })
      : null

    if (resolved) {
      return NextResponse.json({
        data: {
          response: resolved.text,
          source: resolved.source,
          intent: resolved.intent,
          confidence: resolved.confidence,
          used_openai: false,
          used_context: false,
        },
      })
    }

    const negotiation = generateNegotiationResponse(body.message)
    let aiText = negotiation.response

    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

      const ai = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.35,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: `
You are a Saudi debt collection assistant for a professional collection company.

Rules:
- Reply in the same language/dialect as the customer.
- If Arabic, use natural Saudi Arabic.
- Be respectful, calm, concise, and human.
- Do not threaten.
- Do not approve discounts, settlements, waivers, or installments.
- If the customer asks for installments, say the request will be raised for management review.
- If the customer says they paid, politely ask for the receipt/proof of payment.
- If the customer says this debt is not theirs or the number is wrong, say the case will be verified.
- If the customer asks what the debt is for, explain using the available debt context only.
- Never invent creditor, product, reference number, or payment details.
- If context is missing, say you will verify the details with the concerned team.
`.trim(),
          },
          {
            role: 'user',
            content: `
CUSTOMER_MESSAGE:
${body.message}

AI_CLASSIFICATION:
Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}
Draft idea: ${negotiation.response}

CUSTOMER_DEBT_CONTEXT:
${JSON.stringify(debtContext, null, 2)}

Write the best reply to the customer.
`.trim(),
          },
        ],
      })

      aiText = ai.choices[0]?.message?.content?.trim() || aiText

      if (!hasContext) {
        await storeCache({
          companyId,
          message: body.message,
          response: aiText,
          intent: negotiation.intent as any,
          language,
          model: 'gpt-4o-mini',
          confidence: 0.8,
          ttlDays: 14,
        })
      }
    }

    return NextResponse.json({
      data: {
        response: aiText,
        source: process.env.OPENAI_API_KEY ? 'openai' : 'fallback',
        intent: negotiation.intent,
        strategy: negotiation.strategy,
        tone: negotiation.tone,
        used_openai: !!process.env.OPENAI_API_KEY,
        used_context: hasContext,
        context_summary: debtContext?.summary ?? null,
      },
    })
  })
}
