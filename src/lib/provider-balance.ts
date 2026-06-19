import { createLogger } from '@/lib/logger'

const log = createLogger('provider-balance')

export type OpenRouterBalance = {
  total_credits: number
  total_usage:   number
  remaining:     number
}

// Real, live remaining credit on the OpenRouter account that powers every
// AI call in the app (collector agent, scoring, OCR, etc.) — not an internal
// estimate, the actual number their billing API reports.
export async function getOpenRouterBalance(): Promise<OpenRouterBalance | null> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!r.ok) { log.error('OpenRouter credits fetch failed', undefined, { status: r.status }); return null }
    const j = await r.json()
    const total_credits = Number(j?.data?.total_credits ?? 0)
    const total_usage = Number(j?.data?.total_usage ?? 0)
    return { total_credits, total_usage, remaining: total_credits - total_usage }
  } catch (err) {
    log.error('OpenRouter credits fetch exception', err as Error)
    return null
  }
}
