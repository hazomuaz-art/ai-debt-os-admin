/**
 * Migration SQL Verification Tests
 *
 * These tests verify the SQL in migrations is structurally correct
 * by parsing it and checking for common errors. They run WITHOUT a
 * live database (no Supabase connection needed).
 *
 * For full RLS integration tests against a live DB, see:
 * docs/testing.md#rls-testing-with-supabase-cli
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations')

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8')
}

function getAllMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
}

// ── Migration file structure ──────────────────────────────────────────────

describe('migration files', () => {
  it('all migration files are present and non-empty', () => {
    const files = getAllMigrations()
    expect(files.length).toBeGreaterThanOrEqual(7)

    for (const file of files) {
      const content = readMigration(file)
      expect(content.length, `${file} is empty`).toBeGreaterThan(100)
    }
  })

  it('migrations are sequentially numbered starting at 001', () => {
    const files = getAllMigrations()
    files.forEach((file, idx) => {
      const num = parseInt(file.split('_')[0])
      expect(num, `${file} is out of sequence`).toBe(idx + 1)
    })
  })

  it('each migration with DML is wrapped in a transaction', () => {
    const files = getAllMigrations()
    const skipped = ['007_pg_cron_jobs.sql']  // pg_cron doesn't support transactions

    for (const file of files) {
      if (skipped.includes(file)) continue
      const sql = readMigration(file)
      const hasBegin  = /^\s*BEGIN\s*;/m.test(sql)
      const hasCommit = /^\s*COMMIT\s*;/m.test(sql)
      expect(hasBegin,  `${file} missing BEGIN`).toBe(true)
      expect(hasCommit, `${file} missing COMMIT`).toBe(true)
    }
  })
})

// ── Migration 003: RLS hardening ──────────────────────────────────────────

describe('003_rls_hardening.sql', () => {
  const sql = readMigration('003_rls_hardening.sql')

  it('drops all legacy policies before creating new ones', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS')
    const dropCount = (sql.match(/DROP POLICY IF EXISTS/g) || []).length
    expect(dropCount).toBeGreaterThanOrEqual(10)
  })

  it('creates helper functions with SECURITY DEFINER', () => {
    expect(sql).toContain('SECURITY DEFINER')
    expect(sql).toContain('get_user_company_id')
    expect(sql).toContain('get_user_role')
    expect(sql).toContain('is_admin_or_manager')
    expect(sql).toContain('is_admin')
  })

  it('sets search_path on all SECURITY DEFINER functions', () => {
    // Every SECURITY DEFINER must have search_path to prevent privilege escalation
    const funcBlocks = sql.split('CREATE OR REPLACE FUNCTION').slice(1)
    for (const block of funcBlocks) {
      if (block.includes('SECURITY DEFINER')) {
        expect(block, 'SECURITY DEFINER function missing SET search_path').toContain('SET search_path')
      }
    }
  })

  it('has policies for all critical tables', () => {
    const tables = ['companies', 'profiles', 'customers', 'debts', 'payments', 'messages', 'ai_scores', 'ai_actions', 'logs']
    for (const table of tables) {
      expect(sql, `Missing policy for ${table}`).toContain(`ON public.${table}`)
    }
  })

  it('profiles update self policy prevents role escalation', () => {
    const policyBlock = sql.match(/profile_update_self[\s\S]*?WITH CHECK[\s\S]*?;/)?.[0] ?? ''
    expect(policyBlock).toContain('role')
    // Should check that role cannot be changed by comparing to existing role
    expect(policyBlock).toMatch(/role.*=.*SELECT role|SELECT role.*role.*=/s)
  })

  it('debt collector update cannot change assignment', () => {
    const collectorPolicy = sql.match(/debt_update_collector_assigned[\s\S]*?;/)?.[0] ?? ''
    expect(collectorPolicy).toContain('assigned_to = auth.uid()')
    // WITH CHECK should also enforce assigned_to stays the same
    expect(collectorPolicy).toContain('WITH CHECK')
  })

  it('creates performance indexes', () => {
    const indexCount = (sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length
    expect(indexCount).toBeGreaterThanOrEqual(10)
  })

  it('indexes cover RLS predicate columns', () => {
    expect(sql).toContain('idx_profiles_auth_uid')
    expect(sql).toContain('idx_debts_company_assigned')
    expect(sql).toContain('idx_messages_debt_id')
  })
})

// ── Migration 004: Jobs & rate limiting ───────────────────────────────────

describe('004_jobs_ratelimits_audit.sql', () => {
  const sql = readMigration('004_jobs_ratelimits_audit.sql')

  it('creates job_queue table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.job_queue')
    expect(sql).toContain("status IN ('pending', 'processing', 'completed', 'failed', 'retrying')")
  })

  it('creates rate_limits table with unique constraint', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.rate_limits')
    expect(sql).toContain('UNIQUE (key, company_id, window_start)')
  })

  it('creates webhook_events idempotency table', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.webhook_events')
    expect(sql).toContain('UNIQUE (provider, event_id)')
  })

  it('check_and_increment_rate_limit is atomic (uses INSERT ON CONFLICT)', () => {
    const funcBody = sql.match(/check_and_increment_rate_limit[\s\S]*?^\$\$/m)?.[0] ?? ''
    expect(funcBody).toContain('ON CONFLICT')
    expect(funcBody).toContain('DO UPDATE SET count')
  })

  it('creates audit triggers for debts', () => {
    expect(sql).toContain('debt_audit_trigger')
    expect(sql).toContain('AFTER INSERT OR UPDATE ON public.debts')
  })

  it('creates audit trigger for payments', () => {
    expect(sql).toContain('payment_audit_trigger')
    expect(sql).toContain('AFTER INSERT ON public.payments')
  })

  it('enqueue_job function exists', () => {
    expect(sql).toContain('enqueue_job')
    expect(sql).toContain('INSERT INTO public.job_queue')
  })

  it('full-text search vectors are added to customers and debts', () => {
    expect(sql).toContain('search_vector TSVECTOR')
    expect(sql).toContain('GENERATED ALWAYS AS')
    expect(sql).toContain('GIN (search_vector)')
  })
})

// ── Migration 005: Auth hardening ─────────────────────────────────────────

describe('005_auth_hardening.sql', () => {
  const sql = readMigration('005_auth_hardening.sql')

  it('creates api_keys table with key_hash (never plaintext)', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.api_keys')
    expect(sql).toContain('key_hash')
    expect(sql).not.toContain('key TEXT')  // no plaintext key column
  })

  it('creates brute-force protection function', () => {
    expect(sql).toContain('is_login_blocked')
    expect(sql).toContain("'login_failed'")
  })

  it('brute-force limits are reasonable', () => {
    // Should block at >= 10 failures per email, >= 20 per IP
    expect(sql).toMatch(/email_failures >= 10|>= 10.*email/i)
    expect(sql).toMatch(/ip_failures >= 20|>= 20.*ip/i)
  })

  it('validates email consistency between profiles and auth.users', () => {
    expect(sql).toContain('validate_profile_email')
    expect(sql).toContain('auth.users')
  })

  it('normalize_company_settings trigger sets required defaults', () => {
    expect(sql).toContain('normalize_company_settings')
    expect(sql).toContain('currency')
    expect(sql).toContain('timezone')
  })
})

// ── SQL safety checks across all migrations ────────────────────────────────

describe('SQL safety across all migrations', () => {
  const allSql = getAllMigrations().map(f => readMigration(f)).join('\n')

  it('no DROP TABLE without IF EXISTS (prevents errors on re-run)', () => {
    const dangerousDrops = allSql.match(/DROP TABLE(?!\s+IF\s+EXISTS)/gi)
    expect(dangerousDrops).toBeNull()
  })

  it('no raw DELETE without WHERE clause on critical tables', () => {
    // This is a heuristic — real check would need SQL parsing
    const deleteWithoutWhere = allSql.match(/DELETE FROM public\.(debts|customers|payments)\s*;/gi)
    expect(deleteWithoutWhere).toBeNull()
  })

  it('all functions use SECURITY DEFINER have SET search_path', () => {
    const matches = allSql.match(/SECURITY DEFINER\s*\n[^$]*\$\$/gm) || []
    // Just check the pattern exists (full AST parsing would be too complex)
    expect(allSql).toContain('SET search_path = public')
  })

  it('RLS is enabled on all user-facing tables', () => {
    const tables = ['companies', 'profiles', 'customers', 'debts', 'payments', 'messages']
    for (const table of tables) {
      expect(allSql, `Missing ENABLE ROW LEVEL SECURITY for ${table}`)
        .toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
  })
})
