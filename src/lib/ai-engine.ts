/* eslint-disable no-console */
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import OpenAI from 'openai'
import type { Debt, Customer, AIFactor } from '@/types'
import { createLogger, captureError } from '@/lib/logger'
import { logOpenAICost } from '@/lib/cost-tracker'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { resolveResponse } from '@/lib/smart-response'

const log = createLogger('ai-engine')

// â”€â”€ OpenAI singleton â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured')
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 2 })
  }
  return _client
}

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface DebtScoringInput {
  debt:                Debt
  customer:            Customer
  payment_history:     Array<{ amount: number; date: string; status: string }>
  days_overdue:        number
  total_payments_made: number
}

export interface ScoreResult {
  score:                  number
  risk_classification:    'low' | 'medium' | 'high' | 'critical'
  collection_probability: number
  recommended_strategy:   string
  factors:                AIFactor[]
}

export interface ActionPlanItem {
  debt_id:              string
  customer_id:          string
  action_type:          'call' | 'whatsapp' | 'email' | 'visit' | 'legal' | 'escalate' | 'settle'
  priority:             'low' | 'medium' | 'high' | 'critical'
  reason:               string
  suggested_message:    string
  best_time_to_contact: string
}

export interface ActionPlanInput {
  debts:        Array<Record<string, unknown> & { id: string; customer_id: string; customer?: Record<string, unknown> | null }>
  date:         string
  company_name: string
  company_id?:  string
}

// â”€â”€ Rule-based fallback scorer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function scoringFallback(input: DebtScoringInput): ScoreResult {
  const daysOverdue  = input.days_overdue
  const balance      = Number(input.debt.current_balance)
  const original     = Number(input.debt.original_amount)
  const income       = Number(input.customer.monthly_income ?? 0)
  const hasPayments  = input.total_payments_made > 0

  let score = 50
  if (daysOverdue === 0)       score += 30
  else if (daysOverdue <= 30)  score += 15
  else if (daysOverdue <= 90)  score -= 10
  else if (daysOverdue <= 180) score -= 25
  else                         score -= 40

  if (hasPayments)                       score += 15
  if (input.total_payments_made >= 3)    score += 10

  const dti = income > 0 ? balance / (income * 12) : 1
  if (dti < 0.2)      score += 15
  else if (dti < 0.5) score += 5
  else if (dti > 1.0) score -= 15
  else if (dti > 2.0) score -= 25

  const recovered = original > 0 ? (original - balance) / original : 0
  if (recovered > 0.5)      score += 10
  else if (recovered > 0.2) score += 5

  score = Math.min(100, Math.max(0, score))

  const risk: ScoreResult['risk_classification'] =
    score < 25 ? 'critical' : score < 50 ? 'high' : score < 75 ? 'medium' : 'low'

  return {
    score,
    risk_classification:    risk,
    collection_probability: Math.round(score * 0.85),
    recommended_strategy:   daysOverdue > 180
      ? 'Legal action or write-off assessment required'
      : daysOverdue > 90
        ? 'Escalate with settlement offer'
        : hasPayments
          ? 'Maintain contact and negotiate payment plan'
          : 'Initiate direct contact and assess willingness to pay',
    factors: [
      { name: 'Days overdue',     impact: daysOverdue === 0 ? 'positive' : daysOverdue > 90 ? 'negative' : 'neutral', weight: Math.min(10, Math.floor(daysOverdue / 18) + 1), description: daysOverdue === 0 ? 'Not overdue' : `${daysOverdue} days overdue` },
      { name: 'Payment history',  impact: hasPayments ? 'positive' : 'negative', weight: hasPayments ? 7 : 4, description: hasPayments ? `${input.total_payments_made} payment(s)` : 'No payments' },
      { name: 'Debt-to-income',   impact: dti < 0.5 ? 'positive' : dti > 1.0 ? 'negative' : 'neutral', weight: 5, description: income > 0 ? `DTI: ${(dti * 100).toFixed(0)}%` : 'Income unknown' },
    ],
  }
}

// â”€â”€ Safe score parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function safeParseScore(content: string): ScoreResult {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(content) } catch { throw new Error('AI returned invalid JSON') }

  const score = Math.min(100, Math.max(0, Number(parsed.score) || 50))
  const validRisks = ['low', 'medium', 'high', 'critical'] as const
  const risk = validRisks.includes(parsed.risk_classification as typeof validRisks[number])
    ? parsed.risk_classification as typeof validRisks[number]
    : 'medium'
  const prob = Math.min(100, Math.max(0, Number(parsed.collection_probability) || 50))
  const factors: AIFactor[] = Array.isArray(parsed.factors)
    ? (parsed.factors as Array<Record<string, unknown>>).slice(0, 8).map(f => ({
        name:        String(f.name ?? '').slice(0, 100),
        impact:      (['positive','negative','neutral'].includes(String(f.impact)) ? f.impact : 'neutral') as 'positive'|'negative'|'neutral',
        weight:      Math.min(10, Math.max(1, Number(f.weight) || 5)),
        description: String(f.description ?? '').slice(0, 200),
      }))
    : []

  return {
    score,
    risk_classification:    risk,
    collection_probability: prob,
    recommended_strategy:   String(parsed.recommended_strategy ?? 'Standard follow-up').slice(0, 500),
    factors,
  }
}

// â”€â”€ Safe action plan parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Handles all GPT response shapes:
//   - bare array: [{...}, {...}]
//   - wrapped:    {"actions": [{...}]}
//   - object map: {"0": {...}, "1": {...}}
//   - keys named "id"/"cust_id" instead of "debt_id"/"customer_id"

function safeParseActions(
  content:      string,
  debtById:     Map<string, { id: string; customer_id: string }>,
  debtList:     Array<{ id: string; customer_id: string }>,
): ActionPlanItem[] {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new Error('AI returned invalid JSON') }

  // Normalise to array regardless of wrapper
  let arr: unknown[]
  if (Array.isArray(parsed)) {
    arr = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    // Common GPT wrappers
    if (Array.isArray(obj.actions))      arr = obj.actions
    else if (Array.isArray(obj.data))    arr = obj.data
    else if (Array.isArray(obj.results)) arr = obj.results
    else {
      // Object map {"0":{...},"1":{...}}
      arr = Object.values(obj).filter(v => v && typeof v === 'object')
    }
  } else {
    arr = []
  }

  const validActionTypes = ['call','whatsapp','email','visit','legal','escalate','settle'] as const
  const validPriorities  = ['low','medium','high','critical'] as const

  return arr.slice(0, 50).map((raw: unknown, index: number): ActionPlanItem => {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

    // Resolve debt: try debt_id, then id (GPT sometimes echoes input key names)
    const rawDebtId = String(a.debt_id ?? a.id ?? '')
    const matchedDebt = debtById.get(rawDebtId)
    const debt = matchedDebt ?? debtList[index % debtList.length]

    // Resolve customer_id similarly
    const rawCustId = String(a.customer_id ?? a.cust_id ?? '')
    const customer_id = rawCustId && debtById.get(rawDebtId)
      ? rawCustId
      : debt.customer_id

    return {
      debt_id:              debt.id,
      customer_id,
      action_type:          validActionTypes.includes(a.action_type as typeof validActionTypes[number]) ? a.action_type as typeof validActionTypes[number] : 'call',
      priority:             validPriorities.includes(a.priority as typeof validPriorities[number]) ? a.priority as typeof validPriorities[number] : 'medium',
      reason:               String(a.reason ?? 'Follow up required').slice(0, 500),
      suggested_message:    String(a.suggested_message ?? 'Follow up with the customer about the outstanding balance.').slice(0, 1000),
      best_time_to_contact: String(a.best_time_to_contact ?? a.best_time ?? '9:00 AM - 5:00 PM').slice(0, 100),
    }
  }).filter(a => a.debt_id && a.customer_id)
}

// â”€â”€ Rule-based action plan fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ruleBasedActionPlan(
  debts:    ActionPlanInput['debts'],
  debtList: Array<{ id: string; customer_id: string }>,
): ActionPlanItem[] {
  return debts.slice(0, 30).map((d, index): ActionPlanItem => {
    const debt = debtList[index] ?? { id: d.id, customer_id: d.customer_id as string }
    const overdue  = d.due_date ? Math.max(0, Math.floor((Date.now() - new Date(d.due_date as string).getTime()) / 86400000)) : 0
    const balance  = Number(d.current_balance ?? 0)
    const customer = (d.customer ?? {}) as Record<string, unknown>
    const hasWA    = !!(customer.whatsapp)
    const hasPhone = !!(customer.phone)

    const action_type: ActionPlanItem['action_type'] =
      overdue > 180 ? 'legal' :
      overdue > 90  ? 'escalate' :
      hasWA         ? 'whatsapp' :
      hasPhone      ? 'call'     : 'email'

    const priority: ActionPlanItem['priority'] =
      overdue > 90 || balance > 50000 ? 'critical' :
      overdue > 30 || balance > 20000 ? 'high'     :
      overdue > 0                     ? 'medium'   : 'low'

    return {
      debt_id:              debt.id,
      customer_id:          debt.customer_id,
      action_type,
      priority,
      reason:               overdue > 0 ? `${overdue} days overdue, balance ${balance} ${d.currency ?? 'SAR'}` : `Upcoming payment due`,
      suggested_message:    "[FALLBACK_CHANGED] Customer " + String(customer.full_name ?? 'Customer') + ", balance " + balance + " " + String(d.currency ?? 'SAR') + " is due. Please contact us to arrange a suitable payment plan.",
      best_time_to_contact: '10:00 AM - 12:00 PM',
    }
  })
}

// â”€â”€ scoreDebt (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function scoreDebt(input: DebtScoringInput): Promise<ScoreResult> {
  const client = getClient()

  const dti = input.customer.monthly_income && Number(input.customer.monthly_income) > 0
    ? ((Number(input.debt.current_balance) / (Number(input.customer.monthly_income) * 12)) * 100).toFixed(1) + '%'
    : 'Unknown'
  const recentPayments = input.payment_history.slice(0, 3).map(p => `${p.date}: ${p.amount} (${p.status})`).join('; ') || 'None'

  const prompt = `Analyze this debt and score it. Return ONLY valid JSON.
DEBT: amount=${input.debt.original_amount} ${input.debt.currency}, balance=${input.debt.current_balance}, status=${input.debt.status}, overdue=${input.days_overdue}d
CUSTOMER: employer=${input.customer.employer ?? 'Unknown'}, DTI=${dti}
PAYMENTS: count=${input.total_payments_made}, recent=${recentPayments}
Return: {"score":<0-100>,"risk_classification":"<low|medium|high|critical>","collection_probability":<0-100>,"recommended_strategy":"<100chars>","factors":[{"name":"<30chars>","impact":"<positive|negative|neutral>","weight":<1-10>,"description":"<80chars>"}]}`

  try {
    const response = await log.time('openai-score', () =>
      client.chat.completions.create({
        model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, max_tokens: 600, response_format: { type: 'json_object' },
      })
    )
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')
    const result = safeParseScore(content)
    const tokensIn  = response.usage?.prompt_tokens     ?? 0
    const tokensOut = response.usage?.completion_tokens ?? 0
    log.info('Debt scored via AI', { debt_id: input.debt.id, score: result.score })
    // Non-blocking cost log
    logOpenAICost({
      company_id:   (input.debt as { company_id?: string }).company_id ?? '',
      action_type:  'score_debt',
      model:        'gpt-4o-mini',
      input_tokens:  tokensIn,
      output_tokens: tokensOut,
      debt_id:       input.debt.id,
      success:       true,
    }).catch(() => {})
    return result
  } catch (err) {
    captureError(err, 'openai_error', { debt_id: input.debt.id })
    log.warn('OpenAI scoring failed â€” using fallback', { debt_id: input.debt.id })
    return scoringFallback(input)
  }
}

// â”€â”€ generateDailyActionPlan (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function generateDailyActionPlan(input: ActionPlanInput): Promise<ActionPlanItem[]> {
  const client = getClient()

  // Build lookup maps upfront â€” used by both AI path and fallback
  const debtById = new Map(input.debts.map(d => [d.id, { id: d.id, customer_id: d.customer_id }]))
  const debtList = Array.from(debtById.values())

  if (!debtList.length) return []

  const debtSummaries = input.debts.slice(0, 30).map(d => ({
    debt_id:    d.id,          // Use debt_id so GPT returns it correctly
    cust_id:    d.customer_id,
    name:       (d.customer as Record<string, unknown> | null)?.full_name ?? 'Unknown',
    balance:    Number(d.current_balance ?? 0),
    currency:   String(d.currency ?? 'SAR'),
    status:     String(d.status ?? 'active'),
    overdue:    d.due_date ? Math.max(0, Math.floor((Date.now() - new Date(String(d.due_date)).getTime()) / 86400000)) : 0,
    score:      (d.ai_score as Record<string, unknown> | null)?.score ?? null,
    has_wa:     !!((d.customer as Record<string, unknown> | null)?.whatsapp),
    has_phone:  !!((d.customer as Record<string, unknown> | null)?.phone),
  }))

  const prompt = `You are a debt collection AI for ${input.company_name}. Date: ${input.date}.
Generate a prioritized daily action plan. Return a JSON object with key "actions" containing an array.

DEBTS (${debtSummaries.length}):
${JSON.stringify(debtSummaries)}

CUSTOMER_DEBT_CONTEXT:
[]

Rules:
- Use whatsapp if has_wa=true, else call if has_phone=true, else email
- legal if overdue>180; escalate if overdue>90; settle if high score+low balance
- critical priority: balance>50000 or overdue>90
- suggested_message must be in natural Saudi Arabic unless customer used another language. It must be respectful, human, specific, non-threatening, under 200 chars. If customer claimed payment, ask politely for receipt. If customer asks installments, suggest a payment plan.

Return exactly this JSON shape:
{"actions":[{"debt_id":"<exact debt_id from input>","customer_id":"<exact cust_id from input>","action_type":"<call|whatsapp|email|visit|legal|escalate|settle>","priority":"<low|medium|high|critical>","reason":"<50 chars>","suggested_message":"<200 chars>","best_time_to_contact":"<time range>"}]}`

  try {
    const response = await log.time('openai-action-plan', () =>
      client.chat.completions.create({
        model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }],
        temperature: 0.3, max_tokens: 4000, response_format: { type: 'json_object' },
      })
    )
    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')

    const actions = safeParseActions(content, debtById, debtList)
    const tokensIn2  = response.usage?.prompt_tokens     ?? 0
    const tokensOut2 = response.usage?.completion_tokens ?? 0
    log.info('Action plan generated via AI', { count: actions.length, date: input.date })
    logOpenAICost({
      company_id:   input.company_id ?? '',
      action_type:  'generate_action_plan',
      model:        'gpt-4o-mini',
      input_tokens:  tokensIn2,
      output_tokens: tokensOut2,
      success:       true,
    }).catch(() => {})
    if (actions.length > 0) return actions

    // If AI returned nothing valid, use fallback rather than empty
    log.warn('AI returned 0 valid actions â€” using rule-based fallback')
    return ruleBasedActionPlan(input.debts, debtList)
  } catch (err) {
    captureError(err, 'openai_error', { context: 'generate_action_plan', date: input.date })
    log.warn('OpenAI action plan failed â€” using rule-based fallback')
    return ruleBasedActionPlan(input.debts, debtList)
  }
}

// â”€â”€ generateCollectionMessage (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function generateCollectionMessage(
  customerName: string, debtAmount: number, currency: string,
  daysOverdue: number, channel: 'whatsapp' | 'sms' | 'email', language: 'en' | 'ar' | 'both' = 'en',
): Promise<string> {
  const client = getClient()
  const channelHint = { whatsapp: '2-3 short paragraphs', sms: 'under 160 chars', email: '3-4 formal paragraphs' }[channel]
  const urgency = daysOverdue > 90 ? 'very urgent' : daysOverdue > 30 ? 'urgent' : 'polite reminder'

  const prompt = `Write a debt collection message (${urgency}).
Customer: ${customerName}, Amount: ${debtAmount} ${currency}, ${daysOverdue} days overdue
Channel: ${channel} â€” ${channelHint}
Language: ${language === 'both' ? 'bilingual English and Arabic' : language}
Tone: professional, respectful, FDCPA-compliant. No threats. Clear call to action.
Return ONLY the message text.`

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 300,
  })
  return response.choices[0]?.message?.content?.trim() ?? ''
}











