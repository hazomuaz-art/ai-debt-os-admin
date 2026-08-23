// PostgreSQL's uuid type accepts every canonical 8-4-4-4-12 hex value,
// including the nil UUID commonly used in deterministic test fixtures.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isCompanyUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** Resolve a routing key from a JSON environment map to exactly one company. */
export function resolveCompanyFromEnvMap(environmentName: string, routingKey: string): string | null {
  const raw = process.env[environmentName]
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${environmentName} must be a valid JSON object`)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${environmentName} must be a JSON object`)
  }

  const value = (parsed as Record<string, unknown>)[routingKey]
  if (value === undefined) return null
  if (!isCompanyUuid(value)) {
    throw new Error(`${environmentName}.${routingKey} must be a company UUID`)
  }
  return value
}
