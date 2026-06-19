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

  // WhatsApp — optional (app works without it)
  { key: 'WHATSAPP_PHONE_NUMBER_ID',     required: false },
  { key: 'WHATSAPP_ACCESS_TOKEN',        required: false },
  { key: 'WHATSAPP_VERIFY_TOKEN',        required: false },
  { key: 'WHATSAPP_BUSINESS_ACCOUNT_ID', required: false },
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

  // Warn if WhatsApp is partially configured
  const waVars = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN']
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
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_VERIFY_TOKEN
  )
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}
