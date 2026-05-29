/**
 * Smart Response Engine
 *
 * Priority order before OpenAI is called:
 *   1. Response Templates  (hand-crafted, always fast, cheapest)
 *   2. AI Memory           (approved learned responses)
 *   3. Response Cache      (recent AI-generated responses for similar inputs)
 *   4. OpenAI              (only if none of the above matched)
 *
 * This module provides:
 *   - detectIntent()       classify incoming message without AI
 *   - findTemplateMatch()  look up response_templates table
 *   - findMemoryMatch()    look up ai_memory table
 *   - findCacheMatch()     look up response_cache table
 *   - resolveResponse()    full pipeline: try all layers, return result + source
 *   - storeCache()         save a new AI response to the cache
 *   - hashMessage()        normalize + hash a message for cache key
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('smart-response-engine')

// ── Types ─────────────────────────────────────────────────────────────────

export type Intent =
  | 'payment_promise' | 'payment_received'
  | 'objection_money' | 'objection_dispute'
  | 'angry' | 'greeting' | 'escalation'
  | 'no_answer' | 'wrong_number'
  | 'request_info' | 'general'

export type ResponseSource = 'template' | 'memory' | 'cache' | 'openai' | 'fallback'

export interface ResolvedResponse {
  text:       string
  source:     ResponseSource
  intent:     Intent
  confidence: number    // 0–1
  cached_id?: string    // response_cache.id if from cache
  template_id?: string  // response_templates.id if from template
  memory_id?: string    // ai_memory.id if from memory
}

export interface IntentResult {
  intent:     Intent
  confidence: number
  matched_patterns: string[]
}

// ── Normalise text for comparison / hashing ───────────────────────────────

export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')   // strip Arabic diacritics
    .replace(/\s+/g, ' ')
}

/** Simple deterministic hash — no crypto module needed server-side in edge */
export function hashMessage(text: string): string {
  const normalized = normalizeText(text)
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + '_' + normalized.length.toString(16)
}

// ── 1. Intent detection (zero DB / zero AI) ───────────────────────────────

/**
 * Classify an incoming message into an intent using a static keyword map.
 * This runs in <1ms with no external calls.
 *
 * The DB intent_patterns table is used for company-specific overrides;
 * this function provides the always-available baseline.
 */
export function detectIntent(message: string): IntentResult {
  const text = normalizeText(message)

  type Rule = { patterns: string[]; weight: number }
  const INTENT_MAP: Record<Intent, Rule> = {
    payment_promise: {
      patterns: ['بسدد','سوف أدفع','هسدد','بكره أسدد','نهاية الشهر','هذا الاسبوع',
                 'i will pay','will pay','gonna pay','end of month'],
      weight: 5,
    },
    payment_received: {
      patterns: ['دفعت','تم السداد','سددت','تحويل','حولت','i paid','paid','payment sent','receipt'],
      weight: 5,
    },
    objection_money: {
      patterns: ['مو عندي','ما عندي فلوس','ما عندي مال','ضائق','ظروف مالية',
                 'no money','broke','can\'t afford','financial problem'],
      weight: 4,
    },
    objection_dispute: {
      patterns: ['مو صاحب الدين','رقم خطأ','غلط','ليس دينى','مو أنا',
                 'not my debt','wrong person','dispute','incorrect'],
      weight: 4,
    },
    angry: {
      patterns: ['محكمة','بشتكي','أبلغ','ما لكم حق','محامي','هددني',
                 'lawyer','sue','report you','harassment','illegal'],
      weight: 5,
    },
    greeting: {
      patterns: ['مرحبا','السلام','أهلا','صباح','مساء','كيف الحال',
                 'hello','hi','good morning','good evening'],
      weight: 2,
    },
    escalation: {
      patterns: ['مدير','مشرف','مسؤول','تصعيد',
                 'manager','supervisor','escalate'],
      weight: 4,
    },
    no_answer: {
      patterns: ['لا يرد','مشغول','الرقم مغلق','لاحقاً','busy','no answer','try later'],
      weight: 3,
    },
    wrong_number: {
      patterns: ['رقم خطأ','مو أنا','غلط رقم','wrong number','not me'],
      weight: 5,
    },
    request_info: {
      patterns: ['كم','متى','أين','كيف','ما هو','what is','how much','when','where'],
      weight: 2,
    },
    general: { patterns: [], weight: 1 },
  }

  let bestIntent: Intent = 'general'
  let bestScore  = 0
  const matched: string[] = []

  for (const [intent, rule] of Object.entries(INTENT_MAP) as [Intent, Rule][]) {
    let score = 0
    for (const p of rule.patterns) {
      if (text.includes(p)) {
        score += rule.weight
        matched.push(p)
      }
    }
    if (score > bestScore) {
      bestScore  = score
      bestIntent = intent
    }
  }

  const confidence = bestScore > 0
    ? Math.min(1, bestScore / 10)
    : 0

  return { intent: bestIntent, confidence, matched_patterns: matched }
}

// ── 2. Template lookup ────────────────────────────────────────────────────

export async function findTemplateMatch(
  companyId: string,
  message:   string,
  intent:    Intent,
  language:  'ar' | 'en' = 'ar',
): Promise<{ text: string; id: string; confidence: number } | null> {
  try {
    const supabase = createServiceClient()

    const { data: templates } = await supabase
      .from('response_templates')
      .select('id, trigger_keywords, intent_category, response_ar, response_en, min_confidence, priority')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('priority')
      .limit(30)

    if (!templates?.length) return null

    const normalized = normalizeText(message)
    let bestTemplate: typeof templates[0] | null = null
    let bestScore = 0

    for (const tpl of templates) {
      // Intent match is a strong signal
      const intentMatch = tpl.intent_category === intent ? 3 : 0

      // Keyword overlap
      const keywordScore = (tpl.trigger_keywords as string[]).reduce((s, kw) => {
        return normalized.includes(normalizeText(kw)) ? s + 2 : s
      }, 0)

      const total = intentMatch + keywordScore
      if (total > bestScore) {
        bestScore    = total
        bestTemplate = tpl
      }
    }

    if (!bestTemplate || bestScore < 2) return null

    const confidence = Math.min(1, bestScore / 8)
    if (confidence < Number(bestTemplate.min_confidence ?? 0.5)) return null

    const text = language === 'ar'
      ? bestTemplate.response_ar
      : (bestTemplate.response_en || bestTemplate.response_ar)

    if (!text) return null

    // Increment use_count (fire-and-forget)
    supabase
      .from('response_templates')
      .update({ use_count: (bestTemplate as { use_count: number }).use_count + 1 })
      .eq('id', bestTemplate.id)
      .then(() => {})
      .catch(() => {})

    return { text, id: bestTemplate.id, confidence }
  } catch (err) {
    log.warn('Template lookup failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

// ── 3. AI Memory lookup ───────────────────────────────────────────────────

export async function findMemoryMatch(
  companyId: string,
  message:   string,
  intent:    Intent,
): Promise<{ text: string; id: string; confidence: number } | null> {
  try {
    const supabase = createServiceClient()

    const { data: entries } = await supabase
      .from('ai_memory')
      .select('id, trigger_pattern, response_text, category, success_rate, use_count')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .eq('status', 'approved')
      .limit(50)

    if (!entries?.length) return null

    const normalized = normalizeText(message)
    let bestEntry: typeof entries[0] | null = null
    let bestScore = 0

    for (const entry of entries) {
      const pattern = normalizeText(entry.trigger_pattern)
      // Exact substring match
      if (normalized.includes(pattern)) {
        const score = (pattern.length / normalized.length) * 10 +
                      (Number(entry.success_rate ?? 0) / 100) * 3
        if (score > bestScore) {
          bestScore = score
          bestEntry = entry
        }
      }
    }

    if (!bestEntry || bestScore < 1) return null

    // Increment use_count (fire-and-forget)
    supabase
      .from('ai_memory')
      .update({
        use_count:   (bestEntry as { use_count: number }).use_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', bestEntry.id)
      .then(() => {})
      .catch(() => {})

    return {
      text:       bestEntry.response_text,
      id:         bestEntry.id,
      confidence: Math.min(1, bestScore / 10),
    }
  } catch (err) {
    log.warn('Memory lookup failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

// ── 4. Cache lookup ───────────────────────────────────────────────────────

export async function findCacheMatch(
  companyId: string,
  message:   string,
): Promise<{ text: string; id: string } | null> {
  try {
    const supabase   = createServiceClient()
    const messageHash = hashMessage(message)

    const { data } = await supabase
      .from('response_cache')
      .select('id, response_text, hit_count')
      .eq('company_id', companyId)
      .eq('message_hash', messageHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (!data) return null

    // Update hit stats (fire-and-forget)
    supabase
      .from('response_cache')
      .update({
        hit_count:  (data as { hit_count: number }).hit_count + 1,
        last_hit_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .then(() => {})
      .catch(() => {})

    return { text: data.response_text, id: data.id }
  } catch (err) {
    log.warn('Cache lookup failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

// ── 5. Store cache entry ──────────────────────────────────────────────────

export async function storeCache(opts: {
  companyId:  string
  message:    string
  response:   string
  intent?:    Intent
  language?:  string
  model?:     string
  confidence?: number
  ttlDays?:   number
}): Promise<void> {
  try {
    const supabase    = createServiceClient()
    const messageHash  = hashMessage(opts.message)
    const expiresAt   = new Date(Date.now() + (opts.ttlDays ?? 7) * 86400000).toISOString()

    await supabase
      .from('response_cache')
      .upsert(
        {
          company_id:    opts.companyId,
          message_hash:  messageHash,
          input_text:    opts.message.slice(0, 500),
          response_text: opts.response,
          intent_category: opts.intent ?? 'general',
          language:      opts.language ?? 'ar',
          model_used:    opts.model,
          confidence:    opts.confidence,
          expires_at:    expiresAt,
          hit_count:     0,
        },
        { onConflict: 'company_id,message_hash' }
      )
  } catch (err) {
    log.warn('Cache store failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}

// ── 6. Full pipeline: resolveResponse ────────────────────────────────────

/**
 * The main entry point for the Smart Response Engine.
 *
 * Tries each layer in order and returns the first match:
 *   template → memory → cache → (caller must call OpenAI)
 *
 * Returns null if no pre-built response is found — the caller
 * should then call OpenAI and store the result via storeCache().
 *
 * @example
 * const resolved = await resolveResponse({ companyId, message, language })
 * if (resolved) {
 *   // use resolved.text — no OpenAI call needed
 *   await trackUsageEvent(companyId, `response_${resolved.source}_hit`)
 * } else {
 *   // call OpenAI
 *   const aiText = await generateCollectionMessage(...)
 *   await storeCache({ companyId, message, response: aiText, ... })
 * }
 */
export async function resolveResponse(opts: {
  companyId: string
  message:   string
  language?: 'ar' | 'en'
}): Promise<ResolvedResponse | null> {
  const { companyId, message, language = 'ar' } = opts

  // Step 0: detect intent (in-memory, no DB)
  const { intent, confidence: intentConfidence } = detectIntent(message)

  log.info('Intent detected', { intent, confidence: intentConfidence, message: message.slice(0, 60) })

  // Step 1: templates (fastest, most reliable)
  const templateMatch = await findTemplateMatch(companyId, message, intent, language)
  if (templateMatch) {
    log.info('Template hit', { template_id: templateMatch.id, intent })
    return {
      text:        templateMatch.text,
      source:      'template',
      intent,
      confidence:  templateMatch.confidence,
      template_id: templateMatch.id,
    }
  }

  // Step 2: AI memory (approved learned responses)
  const memoryMatch = await findMemoryMatch(companyId, message, intent)
  if (memoryMatch) {
    log.info('Memory hit', { memory_id: memoryMatch.id, intent })
    return {
      text:       memoryMatch.text,
      source:     'memory',
      intent,
      confidence: memoryMatch.confidence,
      memory_id:  memoryMatch.id,
    }
  }

  // Step 3: response cache (recent AI outputs for identical input)
  const cacheMatch = await findCacheMatch(companyId, message)
  if (cacheMatch) {
    log.info('Cache hit', { cache_id: cacheMatch.id })
    return {
      text:       cacheMatch.text,
      source:     'cache',
      intent,
      confidence: 0.9,
      cached_id:  cacheMatch.id,
    }
  }

  // Nothing found — caller must invoke OpenAI
  log.info('No pre-built response — OpenAI required', { intent, message: message.slice(0, 60) })
  return null
}
