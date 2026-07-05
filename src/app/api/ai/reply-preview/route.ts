import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { resolveResponse, storeCache } from '@/lib/smart-response'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { runCollectorAgent } from '@/lib/ai-collector-agent'

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

    // Real interconnection gap this fixes: this route used to run its own
    // separate hand-written prompt on a different model (gpt-4o-mini),
    // completely disconnected from src/lib/ai-collector-agent.ts — none of
    // that file's fixes (the concurrency lock, the fabricated-promise
    // guards, the phrasing-variety rules) ever applied to what an admin saw
    // when testing here. A real customer/debt match now runs through the
    // EXACT SAME runCollectorAgent() the live WhatsApp webhook uses, so a
    // test here reflects real production behavior. The cache/negotiation
    // fallback below is kept ONLY for the no-real-customer-matched case,
    // where runCollectorAgent has no debt/customer to build real context
    // from at all.
    if (matchedCustomerId) {
      const decision = await runCollectorAgent({
        company_id: companyId,
        customer_id: matchedCustomerId,
        debt_id: matchedDebtId,
        message: body.message,
      })
      return NextResponse.json({
        data: {
          response: decision.message,
          source: 'runCollectorAgent',
          action: decision.action,
          reason: decision.reason,
          promised_date: decision.promised_date ?? null,
          promise_text: decision.promise_text ?? null,
          used_openai: true,
          used_context: true,
          matched_customer_id: matchedCustomerId,
          matched_debt_id: decision.resolvedDebtId ?? matchedDebtId,
          context_summary: debtContext?.summary ?? null,
        },
      })
    }

    const resolved = await resolveResponse({ companyId, message: body.message, language })
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
    const aiText = negotiation.response
    await storeCache({
      companyId,
      message: body.message,
      response: aiText,
      intent: negotiation.intent as any,
      language,
      model: 'lexicon-fallback',
      confidence: 0.5,
      ttlDays: 14,
    })

    return NextResponse.json({
      data: {
        response: aiText,
        source: 'fallback_no_customer_matched',
        intent: negotiation.intent,
        strategy: negotiation.strategy,
        tone: negotiation.tone,
        used_openai: false,
        used_context: false,
        matched_customer_id: null,
        matched_debt_id: null,
        context_summary: null,
      },
    })
  })
}






