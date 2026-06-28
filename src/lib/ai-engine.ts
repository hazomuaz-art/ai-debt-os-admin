/* eslint-disable no-console */
import OpenAI from 'openai'
import type { Debt, Customer, AIFactor } from '@/types'
import { createLogger, captureError } from '@/lib/logger'
import { logOpenAICost } from '@/lib/cost-tracker'

const log = createLogger('ai-engine')

// ── OpenAI client ─────────────────────────────────────────────────────────
// Deliberately NOT cached as a module-level singleton: constructing the SDK
// wrapper is cheap (no network/connection-pool cost), and caching it caused
// a real test-isolation bug — a test that re-mocked the `openai` module and
// re-imported this file fresh still got the FIRST test's cached client,
// silently ignoring its own mock.

function getClient(): OpenAI {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured')
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    timeout: 30_000, maxRetries: 2,
  })
}

// ── Types ─────────────────────────────────────────────────────────────────

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
}

// ── Rule-based fallback scorer ────────────────────────────────────────────

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
      ? 'يُنصح بالتصعيد القانوني أو دراسة إعدام الدين'
      : daysOverdue > 90
        ? 'التصعيد مع عرض تسوية'
        : hasPayments
          ? 'مواصلة التواصل والتفاوض على خطة سداد'
          : 'بدء تواصل مباشر وتقييم مدى الاستعداد للسداد',
    factors: [
      { name: 'أيام التأخر',          impact: daysOverdue === 0 ? 'positive' : daysOverdue > 90 ? 'negative' : 'neutral', weight: Math.min(10, Math.floor(daysOverdue / 18) + 1), description: daysOverdue === 0 ? 'غير متأخر' : `متأخر ${daysOverdue} يوم` },
      { name: 'سجل السداد',           impact: hasPayments ? 'positive' : 'negative', weight: hasPayments ? 7 : 4, description: hasPayments ? `${input.total_payments_made} دفعة` : 'لا توجد دفعات' },
      { name: 'نسبة الدين إلى الدخل', impact: dti < 0.5 ? 'positive' : dti > 1.0 ? 'negative' : 'neutral', weight: 5, description: income > 0 ? `النسبة: ${(dti * 100).toFixed(0)}%` : 'الدخل غير معروف' },
    ],
  }
}

// ── Safe score parser ─────────────────────────────────────────────────────

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

// ── Safe action plan parser ───────────────────────────────────────────────
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
      suggested_message:    String(a.suggested_message ?? a.message ?? '').slice(0, 1000),
      best_time_to_contact: String(a.best_time_to_contact ?? a.best_time ?? '9:00 AM - 5:00 PM').slice(0, 100),
    }
  }).filter(a => a.debt_id && a.customer_id)
}

// ── Rule-based action plan fallback ───────────────────────────────────────

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
      suggested_message:    `Dear ${String(customer.full_name ?? 'Customer')}, please contact us regarding your outstanding balance of ${balance} ${d.currency ?? 'SAR'}.`,
      best_time_to_contact: '10:00 AM - 12:00 PM',
    }
  })
}

// ── scoreDebt (public) ────────────────────────────────────────────────────

export async function scoreDebt(input: DebtScoringInput): Promise<ScoreResult> {
  const client = getClient()

  const dti = input.customer.monthly_income && Number(input.customer.monthly_income) > 0
    ? ((Number(input.debt.current_balance) / (Number(input.customer.monthly_income) * 12)) * 100).toFixed(1) + '%'
    : 'Unknown'
  const recentPayments = input.payment_history.slice(0, 3).map(p => `${p.date}: ${p.amount} (${p.status})`).join('; ') || 'None'

  const prompt = `Analyze this debt and score it. Return ONLY valid JSON.
IMPORTANT: write "recommended_strategy", every factor "name", and every factor "description" in ARABIC. Keep "risk_classification" and "impact" in English enum values.
DEBT: amount=${input.debt.original_amount} ${input.debt.currency}, balance=${input.debt.current_balance}, status=${input.debt.status}, overdue=${input.days_overdue}d
CUSTOMER: employer=${input.customer.employer ?? 'Unknown'}, DTI=${dti}
PAYMENTS: count=${input.total_payments_made}, recent=${recentPayments}
Return: {"score":<0-100>,"risk_classification":"<low|medium|high|critical>","collection_probability":<0-100>,"recommended_strategy":"<استراتيجية بالعربية، 100 حرف>","factors":[{"name":"<اسم العامل بالعربية، 30 حرف>","impact":"<positive|negative|neutral>","weight":<1-10>,"description":"<وصف بالعربية، 80 حرف>"}]}`

  try {
    const response = await log.time('openai-score', () =>
      client.chat.completions.create({
        model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: prompt }],
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
      model:        'openai/gpt-4o-mini',
      input_tokens:  tokensIn,
      output_tokens: tokensOut,
      debt_id:       input.debt.id,
      success:       true,
    }).catch(() => {})
    return result
  } catch (err) {
    captureError(err, 'openai_error', { debt_id: input.debt.id })
    log.warn('OpenAI scoring failed — using fallback', { debt_id: input.debt.id })
    return scoringFallback(input)
  }
}

// ── generateDailyActionPlan (public) ────────────────────────────────────

export async function generateDailyActionPlan(input: ActionPlanInput): Promise<ActionPlanItem[]> {
  const client = getClient()

  // Build lookup maps upfront — used by both AI path and fallback
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

Rules:
- Use whatsapp if has_wa=true, else call if has_phone=true, else email
- legal if overdue>180; escalate if overdue>90; settle if high score+low balance
- critical priority: balance>50000 or overdue>90
- suggested_message must be professional, specific, non-threatening, under 200 chars

Return exactly this JSON shape:
{"actions":[{"debt_id":"<exact debt_id from input>","customer_id":"<exact cust_id from input>","action_type":"<call|whatsapp|email|visit|legal|escalate|settle>","priority":"<low|medium|high|critical>","reason":"<50 chars>","suggested_message":"<200 chars>","best_time_to_contact":"<time range>"}]}`

  try {
    const response = await log.time('openai-action-plan', () =>
      client.chat.completions.create({
        model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: prompt }],
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
      company_id:   '',   // set by caller who knows company_id
      action_type:  'generate_action_plan',
      model:        'openai/gpt-4o-mini',
      input_tokens:  tokensIn2,
      output_tokens: tokensOut2,
      success:       true,
    }).catch(() => {})
    if (actions.length > 0) return actions

    // If AI returned nothing valid, use fallback rather than empty
    log.warn('AI returned 0 valid actions — using rule-based fallback')
    return ruleBasedActionPlan(input.debts, debtList)
  } catch (err) {
    captureError(err, 'openai_error', { context: 'generate_action_plan', date: input.date })
    log.warn('OpenAI action plan failed — using rule-based fallback')
    return ruleBasedActionPlan(input.debts, debtList)
  }
}

// ── generateCollectionMessage (public) ───────────────────────────────────

export async function generateCollectionMessage(
  customerName: string, debtAmount: number, currency: string,
  daysOverdue: number, channel: 'whatsapp' | 'sms' | 'email', language: 'en' | 'ar' | 'both' = 'en',
): Promise<string> {
  const client = getClient()
  const channelHint = { whatsapp: '2-3 short paragraphs', sms: 'under 160 chars', email: '3-4 formal paragraphs' }[channel]
  const urgency = daysOverdue > 90 ? 'very urgent' : daysOverdue > 30 ? 'urgent' : 'polite reminder'

  const prompt = `Write a debt collection message (${urgency}).
Customer: ${customerName}, Amount: ${debtAmount} ${currency}, ${daysOverdue} days overdue
Channel: ${channel} — ${channelHint}
Language: ${language === 'both' ? 'bilingual English and Arabic' : language}
Tone: professional, respectful, FDCPA-compliant. No threats. Clear call to action.
Return ONLY the message text.`

  const response = await client.chat.completions.create({
    model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 300,
  })
  return response.choices[0]?.message?.content?.trim() ?? ''
}
