// ============================================================
// Environment Validation
// Called at build time and runtime to catch missing config early
// ============================================================

interface EnvVar {
  key:      string
  required: boolean
  validate?: (value: string) => string | null  // returns error message or null
}

const ENV_VARS: EnvVar[] = [
  // Supabase — required
  {
    key:      'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    validate: v => v.startsWith('https://') && v.includes('.supabase.co')
      ? null
      : 'Must be a valid Supabase URL (https://xxx.supabase.co)',
  },
  {
    key:      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    required: true,
    validate: v => v.length > 20 ? null : 'Anon key appears invalid',
  },
  {
    key:      'SUPABASE_SERVICE_ROLE_KEY',
    required: true,
    validate: v => v.length > 20 ? null : 'Service role key appears invalid',
  },

  // OpenRouter — required (all AI calls route through it)
  {
    key:      'OPENROUTER_API_KEY',
    required: true,
    validate: v => v.startsWith('sk-or-') ? null : 'OpenRouter key must start with sk-or-',
  },

  // App security — required
  {
    key:      'APP_SECRET',
    required: true,
    validate: v => v.length >= 32 ? null : 'APP_SECRET must be at least 32 characters',
  },
  {
    key:      'NEXT_PUBLIC_APP_URL',
    required: true,
    validate: v => v.startsWith('http') ? null : 'Must be a valid URL',
  },

  // WhatsApp — optional (app works without it). The actual gateway this
  // app talks to is WAHA (src/lib/whatsapp.ts), not the official WhatsApp
  // Business Cloud API — the WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN/
  // VERIFY_TOKEN/BUSINESS_ACCOUNT_ID vars this used to check are legacy
  // and unset in every real environment, which made this check (and the
  // /api/health route it feeds) report "not configured" unconditionally
  // in production even with a fully healthy WAHA session.
  { key: 'WAHA_API_URL',     required: false },
  { key: 'WAHA_API_KEY',     required: false },
  { key: 'WAHA_SESSION',     required: false },
]

export interface EnvValidationResult {
  valid:    boolean
  missing:  string[]
  invalid:  Array<{ key: string; message: string }>
  warnings: string[]
}

export function validateEnv(): EnvValidationResult {
  const missing:  string[]                             = []
  const invalid:  Array<{ key: string; message: string }> = []
  const warnings: string[]                             = []

  for (const env of ENV_VARS) {
    const value = process.env[env.key]

    if (!value) {
      if (env.required) {
        missing.push(env.key)
      } else {
        warnings.push(`${env.key} is not set — related features disabled`)
      }
      continue
    }

    if (env.validate) {
      const err = env.validate(value)
      if (err) {
        invalid.push({ key: env.key, message: err })
      }
    }
  }

  // Warn if WAHA (WhatsApp gateway) is partially configured
  const waVars = ['WAHA_API_URL', 'WAHA_API_KEY', 'WAHA_SESSION']
  const waSet  = waVars.filter(k => process.env[k])
  if (waSet.length > 0 && waSet.length < waVars.length) {
    warnings.push(`WhatsApp is partially configured (${waSet.length}/${waVars.length} vars set)`)
  }

  return {
    valid:    missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    warnings,
  }
}

// Throw on startup if env is invalid (for server builds)
export function assertEnv(): void {
  const result = validateEnv()

  if (result.warnings.length) {
    for (const w of result.warnings) {
      console.warn(`[ENV] Warning: ${w}`) // eslint-disable-line no-console
    }
  }

  if (!result.valid) {
    const lines: string[] = ['[ENV] Invalid environment configuration:']
    for (const key of result.missing) {
      lines.push(`  MISSING: ${key}`)
    }
    for (const { key, message } of result.invalid) {
      lines.push(`  INVALID: ${key} — ${message}`)
    }
    throw new Error(lines.join('\n'))
  }
}

// Safe check (doesn't throw) for use in API routes
export function isWhatsAppConfigured(): boolean {
  return !!(
    process.env.WAHA_API_URL &&
    process.env.WAHA_API_KEY &&
    process.env.WAHA_SESSION
  )
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}
