import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { withAuth, errors } from '@/lib/api'
import { resolveResponse, storeCache } from '@/lib/smart-response'
import { generateNegotiationResponse } from '@/lib/negotiation-response'

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: { message?: string; language?: 'ar' | 'en' }

    try {
      body = await req.json()
    } catch {
      return errors.badRequest('Invalid JSON')
    }

    if (!body.message) return errors.badRequest('message required')

    const language = body.language ?? 'ar'

    const resolved = await resolveResponse({
      companyId: ctx.profile.company_id,
      message: body.message,
      language
    })

    if (resolved) {
      return NextResponse.json({
        data: {
          response: resolved.text,
          source: resolved.source,
          intent: resolved.intent,
          confidence: resolved.confidence,
          used_openai: false
        }
      })
    }

    const negotiation = generateNegotiationResponse(body.message)

    let aiText = negotiation.response

    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

      const ai = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 250,
        messages: [
          {
            role: 'system',
            content:
              'You are a Saudi debt collection assistant. Reply naturally in Saudi Arabic if the customer writes Arabic. Be respectful, calm, concise, non-threatening, and helpful.'
          },
          {
            role: 'user',
            content: `Customer message: ${body.message}

Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}
Draft idea: ${negotiation.response}

Write the best reply.`
          }
        ]
      })

      aiText = ai.choices[0]?.message?.content?.trim() || aiText

      await storeCache({
        companyId: ctx.profile.company_id,
        message: body.message,
        response: aiText,
        intent: negotiation.intent as any,
        language,
        model: 'gpt-4o-mini',
        confidence: 0.8,
        ttlDays: 14
      })
    }

    return NextResponse.json({
      data: {
        response: aiText,
        source: process.env.OPENAI_API_KEY ? 'openai' : 'fallback',
        intent: negotiation.intent,
        strategy: negotiation.strategy,
        tone: negotiation.tone,
        used_openai: !!process.env.OPENAI_API_KEY
      }
    })
  })
}
