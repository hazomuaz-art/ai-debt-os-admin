import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { withAuth, errors } from '@/lib/api'
import { resolveResponse, storeCache } from '@/lib/smart-response'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/ai/reply-preview')

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: {
      message?: string
      language?: 'ar' | 'en'
      customer_id?: string
      debt_id?: string
      conversation_history?: Array<{ role: 'customer' | 'ai'; text: string }>
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
    let matchedCustomerId = body.customer_id ?? null
    let matchedDebtId = body.debt_id ?? null

    if (!matchedCustomerId && body.message) {
      const rawText = String(body.message)
      const digits = rawText.replace(/\D/g, '')
      const tokens = rawText
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 8)

      if (digits.length >= 6) {
        const { data: customerMatch } = await ctx.supabase
          .from('customers')
          .select('id')
          .eq('company_id', companyId)
          .or(`phone.ilike.%${digits}%,whatsapp.ilike.%${digits}%,national_id.ilike.%${digits}%`)
          .limit(1)
          .maybeSingle()

        if (customerMatch?.id) {
          matchedCustomerId = customerMatch.id
        }

        if (!matchedCustomerId) {
          const { data: debtMatch } = await ctx.supabase
            .from('debts')
            .select('id, customer_id')
            .eq('company_id', companyId)
            .or(`account_number.ilike.%${digits}%,reference_number.ilike.%${digits}%`)
            .limit(1)
            .maybeSingle()

          if (debtMatch?.customer_id) {
            matchedCustomerId = debtMatch.customer_id
            matchedDebtId = debtMatch.id
          }
        }
      }

      if (!matchedCustomerId && tokens.length) {
        const nameQuery = tokens.join(' ')
        const { data: customerByName } = await ctx.supabase
          .from('customers')
          .select('id')
          .eq('company_id', companyId)
          .ilike('full_name', `%${nameQuery}%`)
          .limit(1)
          .maybeSingle()

        if (customerByName?.id) {
          matchedCustomerId = customerByName.id
        }
      }
    }

    if (matchedCustomerId) {
      debtContext = await buildCustomerDebtContext({
        company_id: companyId,
        customer_id: matchedCustomerId,
        debt_id: matchedDebtId ?? null,
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

    if (process.env.OPENROUTER_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })

      const ai = await client.chat.completions.create({
        model: 'openai/gpt-4o-mini',
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
- Use Saudi conversational wording such as: "طيب"، "خلّنا نوضحها"، "المبلغ ظاهر عندنا"، "نقدر نرفع طلب مراجعة"، "وش الوقت المناسب للسداد؟"، "نرتبها بالطريقة الصحيحة".
- Avoid classical phrases and formal Arabic structures like: "يرجى التكرم"، "نفيدكم"، "عميلنا العزيز"، "نود إشعاركم".
- Never use canned phrases like حياك الله، أبشر، شكراً لتواصلك، or any generic support-style opening.
- If the customer only greets, reply only with: وعليكم السلام. If they add a debt question, answer that question directly without adding support-style openings.
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

Negotiation Intelligence Rules:
- Always inspect CUSTOMER_DEBT_CONTEXT.negotiation_profile before writing the reply.
- Do not treat all customers the same.
- If behavior_type is angry: acknowledge briefly, do not argue, then move to verification or a practical next step.
- If behavior_type is refusing: do not repeat the balance only; ask for the real reason and move toward review, partial payment, or a concrete next step.
- If behavior_type is procrastinator: be firmer. Do not accept vague answers. Ask for a specific payment date and amount.
- If behavior_type is cooperative: keep it smooth and close the next step quickly.
- If behavior_type is payment_claim: ask for receipt, transfer reference, or proof, and say it will be checked.
- If behavior_type is promise_signal: confirm exact amount and date.
- If the context has recent_messages, do not ignore them. Continue the conversation naturally.
- If the context has recent_promises, use them before asking a new question.
- If the context has recent_payments, acknowledge that history when relevant.
- If debt details exist, answer with the actual balance, creditor, product, reference, and status when relevant.
- Never ask for information that already exists in CUSTOMER_DEBT_CONTEXT.
- Never say vague phrases like "نحتاج تفاصيل أكثر" when the context already has usable debt/customer information.
- Your reply must sound like a real collector who has the customer file open, not like a chatbot.

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
CONVERSATION_HISTORY:
${JSON.stringify(body.conversation_history ?? [], null, 2)}

LATEST_CUSTOMER_MESSAGE:
${body.message}

AI_CLASSIFICATION:
Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}
Draft idea: ${negotiation.response}

CUSTOMER_DEBT_CONTEXT:
${JSON.stringify(debtContext, null, 2)}

Write the best reply to the latest customer message.

Important:
- Use CONVERSATION_HISTORY to understand what the customer already said.
- Do not ask for the same detail twice.
- If the customer says "بعطيك رقم الهوية" then later says "رقم الهوية قلت", understand the topic is national ID.
- If the customer sends only a number after discussing identity/account/phone, treat it as the identifier they were asked/proposed to provide.
- Do not respond with vague phrases like "تحتاج توضيح أكثر" if the conversation history already explains the intent.
- Continue the conversation like a human collector following the same chat, not as a new isolated message.
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
          model: 'openai/gpt-4o-mini',
          confidence: 0.8,
          ttlDays: 14,
        })
      }
    }

    if (body.customer_id) {
      const now = new Date().toISOString()

      const { error: previewMsgErr } = await ctx.supabase.from('messages').insert([
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
      if (previewMsgErr) log.error('reply-preview messages insert failed', previewMsgErr, { customer_id: body.customer_id })

      const { error: previewTlErr } = await ctx.supabase.from('timeline_events').insert([
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
      if (previewTlErr) log.error('reply-preview timeline insert failed', previewTlErr, { customer_id: body.customer_id })
    }

    return NextResponse.json({
      data: {
        response: aiText,
        source: process.env.OPENROUTER_API_KEY ? 'openai' : 'fallback',
        intent: negotiation.intent,
        strategy: negotiation.strategy,
        tone: negotiation.tone,
        used_openai: !!process.env.OPENROUTER_API_KEY,
        used_context: hasContext,
        matched_customer_id: matchedCustomerId,
        matched_debt_id: matchedDebtId,
        context_summary: debtContext?.summary ?? null,
      },
    })
  })
}






