import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Structural regression guard for a real bug class found in a full-system
// audit (2026-06-29): at least 7 separate timeline_events.insert() call
// sites across the codebase used event_type/channel/actor_type string
// literals that don't exist in the real CHECK constraints
// (timeline_events_event_type_check / _channel_check / _actor_type_check —
// see supabase/migrations/001_initial_schema.sql). Supabase's JS client
// never throws on a constraint violation, so every one of these silently
// never wrote anything, for every company, since each feature shipped.
//
// This scans every actual .ts source file for an `event_type:` (or
// `channel:`/`actor_type:`) string literal that appears within the same
// object literal as a `timeline_events` reference, and fails loudly if any
// value isn't in the real allowed list — so a regression is caught by CI,
// not discovered months later in a live customer's broken case summary.
const VALID_EVENT_TYPES = new Set([
  'whatsapp_in', 'whatsapp_out', 'call_in', 'call_out', 'ai_reply',
  'collector_note', 'promise_to_pay', 'payment', 'status_change',
  'ai_analysis', 'rule_triggered', 'campaign', 'human_handoff', 'escalation',
])
const VALID_CHANNELS = new Set(['whatsapp', 'call', 'email', 'sms', 'system', 'ai', 'manual'])
const VALID_ACTOR_TYPES = new Set(['ai', 'collector', 'customer', 'system', 'campaign'])

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listTsFiles(full))
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) out.push(full)
  }
  return out
}

// Finds every `timeline_events').insert({ ... })` call (single or array)
// and extracts the object literal text so we can pull out the three
// constrained fields from THAT specific call, not just anywhere in the file.
function extractTimelineInsertBlocks(source: string): string[] {
  const blocks: string[] = []
  const marker = "timeline_events').insert("
  let idx = source.indexOf(marker)
  while (idx !== -1) {
    // Grab a generous window after the call — enough to contain the whole
    // object literal in every real call site in this codebase (none are
    // anywhere near this long), without needing a real parser.
    blocks.push(source.slice(idx, idx + 1500))
    idx = source.indexOf(marker, idx + marker.length)
  }
  return blocks
}

function extractLiteralValue(block: string, field: string): string[] {
  // Matches `event_type: 'foo'` or `event_type: "foo"` — deliberately
  // ignores dynamic values (e.g. `event_type: someVar`), since those can't
  // be statically checked here; every bug found in the audit was a literal.
  const re = new RegExp(`${field}\\s*:\\s*['"]([a-z_]+)['"]`, 'g')
  const values: string[] = []
  let m
  while ((m = re.exec(block)) !== null) values.push(m[1])
  return values
}

describe('timeline_events constraint guard — every literal must be a real, valid value', () => {
  const srcDir = join(__dirname, '..', '..', 'src')
  const files = listTsFiles(srcDir)
  const violations: string[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf-8')
    if (!source.includes('timeline_events')) continue
    for (const block of extractTimelineInsertBlocks(source)) {
      for (const v of extractLiteralValue(block, 'event_type')) {
        if (!VALID_EVENT_TYPES.has(v)) violations.push(`${file}: event_type '${v}' is not a valid timeline_events.event_type`)
      }
      for (const v of extractLiteralValue(block, 'channel')) {
        if (!VALID_CHANNELS.has(v)) violations.push(`${file}: channel '${v}' is not a valid timeline_events.channel`)
      }
      for (const v of extractLiteralValue(block, 'actor_type')) {
        if (!VALID_ACTOR_TYPES.has(v)) violations.push(`${file}: actor_type '${v}' is not a valid timeline_events.actor_type`)
      }
    }
  }

  it('found at least one real timeline_events insert to check (sanity check the scanner itself works)', () => {
    expect(files.some(f => readFileSync(f, 'utf-8').includes("timeline_events').insert("))).toBe(true)
  })

  it('has zero invalid event_type/channel/actor_type literals anywhere in src/', () => {
    expect(violations).toEqual([])
  })
})
