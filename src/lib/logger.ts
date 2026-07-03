/* eslint-disable no-console */
// ============================================================
// Structured production logger
// Outputs JSON in production (for log aggregators like Datadog,
// Logtail, Axiom) and human-readable in development.
// ============================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level:     LogLevel
  message:   string
  service:   string
  env:       string
  context?:  LogContext
  error?:    {
    message: string
    stack?:  string
    code?:   string
  }
}

const SERVICE_NAME = 'ai-debt-os'
const IS_PROD      = process.env.NODE_ENV === 'production'
const LOG_LEVEL    = (process.env.LOG_LEVEL ?? 'info') as LogLevel

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[LOG_LEVEL]
}

function serialize(entry: LogEntry): string {
  if (IS_PROD) {
    return JSON.stringify(entry)
  }

  const colors: Record<LogLevel, string> = {
    debug: '\x1b[34m',  // blue
    info:  '\x1b[32m',  // green
    warn:  '\x1b[33m',  // yellow
    error: '\x1b[31m',  // red
  }
  const reset = '\x1b[0m'
  const color = colors[entry.level]

  const time    = new Date(entry.timestamp).toTimeString().split(' ')[0]
  const prefix  = `${color}[${entry.level.toUpperCase()}]${reset} ${time}`
  const context = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
  const errStr  = entry.error   ? `\n  Error: ${entry.error.message}${entry.error.stack ? '\n' + entry.error.stack : ''}` : ''

  return `${prefix} ${entry.message}${context}${errStr}`
}

function writeLog(level: LogLevel, message: string, context?: LogContext, error?: Error) {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service:   SERVICE_NAME,
    env:       process.env.NODE_ENV ?? 'development',
  }

  if (context && Object.keys(context).length > 0) {
    entry.context = context
  }

  if (error) {
    entry.error = {
      message: error.message,
      stack:   IS_PROD ? undefined : error.stack,
      code:    (error as any).code,
    }
  }

  const output = serialize(entry)

  if (level === 'error') {
    console.error(output)
  } else if (level === 'warn') {
    console.warn(output)
  } else {
    console.log(output)
  }
}

// Root-cause fix for a recurring bug class (2026-07-03): callers keep
// passing raw Supabase `{error}` objects (PostgrestError — a plain object,
// not an Error instance) as the 2nd param. The old `new Error(String(x))`
// coercion turned every one of them into the useless "[object Object]" —
// found live in production twice, across 20+ call sites, even after a
// 28-site sweep fixed the known ones. Coercing properly HERE makes the
// entire class impossible regardless of what any future call site passes.
function coerceError(error: unknown): Error | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) return error
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>
    const msg = typeof o.message === 'string' && o.message
      ? o.message
      : (() => { try { return JSON.stringify(error) } catch { return String(error) } })()
    const e = new Error(msg)
    if (typeof o.code === 'string') (e as Error & { code?: string }).code = o.code
    return e
  }
  return new Error(String(error))
}

// ── Logger factory ─────────────────────────────────────────────────────────

export function createLogger(module: string) {
  return {
    debug: (message: string, context?: LogContext) =>
      writeLog('debug', `[${module}] ${message}`, context),

    info: (message: string, context?: LogContext) =>
      writeLog('info', `[${module}] ${message}`, context),

    warn: (message: string, context?: LogContext) =>
      writeLog('warn', `[${module}] ${message}`, context),

    error: (message: string, error?: Error | unknown, context?: LogContext) => {
      writeLog('error', `[${module}] ${message}`, context, coerceError(error))
    },

    // For timing async operations
    time: <T>(label: string, fn: () => Promise<T>, context?: LogContext): Promise<T> => {
      const start = Date.now()
      return fn().then(
        result => {
          writeLog('debug', `[${module}] ${label} completed`, {
            ...context,
            duration_ms: Date.now() - start,
          })
          return result
        },
        err => {
          writeLog('error', `[${module}] ${label} failed`, {
            ...context,
            duration_ms: Date.now() - start,
          }, coerceError(err))
          throw err
        }
      )
    },
  }
}

// ── Request logging middleware helper ──────────────────────────────────────

export function logRequest(
  method: string,
  path:   string,
  status: number,
  durationMs: number,
  context?: LogContext
) {
  const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  writeLog(level, `${method} ${path} ${status}`, {
    ...context,
    duration_ms: durationMs,
    status,
  })
}

// ── Default logger ─────────────────────────────────────────────────────────

export const logger = createLogger('app')

// ── Error classification for monitoring ────────────────────────────────────

export type ErrorCategory =
  | 'openai_error'
  | 'whatsapp_error'
  | 'database_error'
  | 'auth_error'
  | 'rate_limit'
  | 'validation_error'
  | 'unexpected_error'

export interface MonitoredError {
  category:  ErrorCategory
  message:   string
  context?:  LogContext
  timestamp: string
}

/**
 * Classify and log an error with appropriate severity and context.
 * In production, this is where you'd send to Sentry, Datadog, etc.
 */
export function captureError(
  error: Error | unknown,
  category: ErrorCategory,
  context?: LogContext
): MonitoredError {
  const err     = coerceError(error) ?? new Error('unknown error')
  const entry: MonitoredError = {
    category,
    message:   err.message,
    context,
    timestamp: new Date().toISOString(),
  }

  writeLog('error', `[${category}] ${err.message}`, context, err)





  return entry
}
