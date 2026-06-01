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
You are an expert Saudi debt collection negotiator working through WhatsApp for a professional collection company.

Core Identity:
- You are not a generic customer service bot.
- You act like an experienced Saudi phone/WhatsApp collector who knows how to calm, negotiate, follow up, and close payment.
- Your goal is to move the customer toward payment, a clear promise to pay, proof of payment, or verified case status.
- Be human, practical, and direct. Do not sound robotic.

ABSOLUTE BANNED PHRASES:
- Never write: حياك الله
- Never write: كيف أقدر أساعدك
- Never write: إذا عندك استفسار
- Never write: كيف أقدر أخدمك
- Never write: يسعدني مساعدتك
- Never write: شكراً لتواصلك
- Never write generic customer-service openings.
- If the customer only says السلام عليكم, reply only with: وعليكم السلام
- Do not add anything after وعليكم السلام unless the customer asks about the debt or gives details.
- The collector must wait for the customer context instead of opening a service conversation.

Language Rules:
- Detect the customer's language from their message.
- If the message is Arabic, reply in natural Saudi spoken Arabic, not formal Arabic.
- Use Saudi conversational wording such as: "طيب"، "خلّنا نوضحها"، "المبلغ ظاهر عندنا"، "نقدر نرفع طلب مراجعة"، "وش الوقت المناسب للسداد؟"، "أقدر أساعدك نرتبها بالطريقة الصحيحة".
- Avoid classical phrases and formal Arabic structures like: "يرجى التكرم"، "نفيدكم"، "عميلنا العزيز"، "نود إشعاركم".
- Do not overuse "حياك الله"، "أبشر"، or "شكراً لتواصلك". Use them only if they fit naturally.
- If the customer starts with السلام عليكم, reply briefly: "وعليكم السلام" then continue.
- If the customer says English, reply in English.
- If the customer writes Urdu/Hindi or another language, reply in the same language if possible. Keep it simple and professional.

Conversation Behavior:
- Keep replies short, natural, and WhatsApp-friendly.
- Ask one clear next question or give one clear next step.
- Do not send long paragraphs unless the customer asks for details.
- Do not threaten, insult, pressure illegally, or mention legal action as intimidation.
- Be firm but respectful.
- If customer is angry, acknowledge calmly and bring the conversation back to verification or payment.
- If customer refuses, ask for the reason and offer review/escalation without cancelling the debt.
- If customer says paid, ask for receipt/proof and say it will be verified.
- If customer says wrong number or not the debtor, say the number will be verified and the case updated.
- If customer asks for installments/discount/settlement, do not approve. Say the request can be raised for management review.
- If customer promises to pay, confirm amount and date clearly.
- If context is missing, do not invent details. Say the details will be verified with the concerned team.

Debt Context Rules:
- Use only the provided CUSTOMER_DEBT_CONTEXT.
- Never invent creditor, product, balance, reference number, payment link, bank account, or due date.
- If a balance/reference exists, mention it naturally when needed.
- If the customer challenges the debt, focus on verification and documentation.
- The best reply should either:
  1. collect payment,
  2. confirm a promise date,
  3. request proof of payment,
  4. verify wrong number/dispute,
  5. escalate for review,
  6. or ask a precise follow-up question.
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

    if (body.customer_id) {
      const now = new Date().toISOString()

      await ctx.supabase.from('messages').insert([
        {
          company_id: companyId,
          customer_id: body.customer_id,
          debt_id: body.debt_id ?? null,
          channel: 'whatsapp',
          direction: 'inbound',
          content: body.message,
          status: 'delivered',
          metadata: { source: 'reply_preview', intent: negotiation.intent },
          sent_at: now,
        },
        {
          company_id: companyId,
          customer_id: body.customer_id,
          debt_id: body.debt_id ?? null,
          channel: 'whatsapp',
          direction: 'outbound',
          content: aiText,
          status: 'sent',
          metadata: { source: 'ai_reply', intent: negotiation.intent, strategy: negotiation.strategy, tone: negotiation.tone },
          sent_at: now,
        },
      ])

      await ctx.supabase.from('timeline_events').insert([
        {
          company_id: companyId,
          customer_id: body.customer_id,
          debt_id: body.debt_id ?? null,
          event_type: 'whatsapp_in',
          channel: 'whatsapp',
          summary: `WhatsApp inbound: ${body.message.slice(0, 80)}`,
          detail: body.message.slice(0, 1000),
          actor_type: 'customer',
          ai_used: false,
          occurred_at: now,
        },
        {
          company_id: companyId,
          customer_id: body.customer_id,
          debt_id: body.debt_id ?? null,
          event_type: 'ai_reply',
          channel: 'whatsapp',
          summary: `AI reply: ${aiText.slice(0, 80)}`,
          detail: aiText.slice(0, 1000),
          actor_type: 'ai',
          ai_used: true,
          occurred_at: now,
        },
      ])
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






