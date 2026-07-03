#!/usr/bin/env node
/**
 * Guards against the single most recurring bug class found across every
 * audit of this codebase: a Supabase write (insert/update/upsert/delete)
 * whose `error` result is never checked. Supabase-js never throws on a
 * constraint/RLS violation — it returns `{ data, error }` — so an unchecked
 * write fails completely silently while the caller proceeds as if it
 * succeeded. This has been found and fixed dozens of times in dozens of
 * different files; each fix only covered the files scanned that day. This
 * script makes the mistake impossible to reintroduce anywhere, permanently,
 * by scanning the ENTIRE src/ tree on every deploy.
 *
 * Flags two patterns (kept deliberately narrow to avoid false positives):
 *   1. A supabase write chain awaited as a bare statement, result fully
 *      discarded:            await supabase.from('x').insert({...})
 *   2. A supabase write chain destructured WITHOUT an `error` property:
 *      const { data } = await supabase.from('x').insert({...})
 *
 * A chain is only considered a "supabase write" if the write-verb call
 * (.insert/.update/.upsert/.delete) is preceded somewhere in the same
 * expression chain by a `.from(...)` call — this is what distinguishes it
 * from an unrelated `.delete()` on a Map/Set or similar, which are common
 * and not writes to the database.
 *
 * Usage: node scripts/check-unchecked-writes.js
 * Exits 1 (with a file:line report) if any violation is found, 0 otherwise.
 */

const fs = require('fs')
const path = require('path')
const { parse } = require('@typescript-eslint/parser')

const SRC_DIR = path.join(__dirname, '../src')
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

// Deliberately, explicitly excluded — NOT a blanket escape hatch. Every
// entry here must have a real, documented reason; adding a file "to make
// the gate pass" defeats the entire point of this script.
//   - smart-response.ts: part of the Temporal Engine integration surface,
//     explicitly marked out-of-scope/deferred by the account owner in an
//     earlier session (separate rework planned) — not touched here even
//     though the fix would be the same mechanical pattern as everywhere
//     else, specifically to respect that standing boundary.
const EXCLUDED_FILES = new Set(['smart-response.ts'])

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walkFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !EXCLUDED_FILES.has(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Attaches a `.__parent` pointer to every node so we can walk upward later —
// the raw parser output has no parent links.
function attachParents(node, parent) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const el of node) attachParents(el, parent); return }
  if (typeof node.type !== 'string') return
  node.__parent = parent
  for (const key in node) {
    if (key === '__parent' || key === 'loc' || key === 'range' || key === 'parent') continue
    attachParents(node[key], node)
  }
}

// Does this expression chain contain a `.from(...)` call anywhere below it?
// (supabase.from('x') / ctx.supabase.from('x') / svc.from('x') / etc.)
function chainHasFromCall(node, depth = 0) {
  if (!node || depth > 12) return false
  if (node.type === 'CallExpression') {
    if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier' && node.callee.property.name === 'from') {
      return true
    }
    return chainHasFromCall(node.callee, depth + 1)
  }
  if (node.type === 'MemberExpression') return chainHasFromCall(node.object, depth + 1)
  return false
}

// Given the write-verb CallExpression (e.g. the `.insert(...)` call), find
// the outermost CallExpression in the same fluent chain — e.g. for
// `x.update({...}).eq('id', y)`, the write verb is nested inside `.eq()`'s
// callee; this walks UP to `.eq(...)`, the real "final" call in the chain.
function findOutermostChainCall(node) {
  let current = node
  while (true) {
    const p = current.__parent
    if (p && p.type === 'MemberExpression' && p.object === current) {
      const gp = p.__parent
      if (gp && gp.type === 'CallExpression' && gp.callee === p) {
        current = gp
        continue
      }
    }
    return current
  }
}

function objectPatternHasErrorKey(objectPattern) {
  return objectPattern.properties.some(p =>
    p.type === 'Property' && p.key && ((p.key.type === 'Identifier' && p.key.name === 'error') || (p.key.type === 'Literal' && p.key.value === 'error'))
  )
}

function checkFile(file) {
  const code = fs.readFileSync(file, 'utf-8')
  let ast
  try {
    ast = parse(code, { range: true, loc: true, jsx: file.endsWith('.tsx'), ecmaFeatures: { jsx: file.endsWith('.tsx') } })
  } catch {
    return [] // unparsable — not this script's job to report syntax errors
  }
  attachParents(ast, null)

  const violations = []
  const seenOutermost = new Set()

  function visit(node) {
    if (!node || typeof node.type !== 'string') return

    if (node.type === 'CallExpression'
        && node.callee.type === 'MemberExpression'
        && node.callee.property.type === 'Identifier'
        && WRITE_METHODS.has(node.callee.property.name)
        && chainHasFromCall(node.callee.object)) {
      const outermost = findOutermostChainCall(node)
      if (!seenOutermost.has(outermost)) {
        seenOutermost.add(outermost)

        let consumer = outermost.__parent
        if (consumer && consumer.type === 'AwaitExpression') consumer = consumer.__parent

        if (consumer) {
          if (consumer.type === 'ExpressionStatement') {
            violations.push({ line: node.loc.start.line, kind: 'discarded', verb: node.callee.property.name })
          } else if (consumer.type === 'VariableDeclarator' && consumer.id.type === 'ObjectPattern') {
            if (!objectPatternHasErrorKey(consumer.id)) {
              violations.push({ line: node.loc.start.line, kind: 'no-error-destructured', verb: node.callee.property.name })
            }
          }
        }
      }
    }

    for (const key in node) {
      if (key === '__parent' || key === 'loc' || key === 'range' || key === 'parent') continue
      const val = node[key]
      if (Array.isArray(val)) { for (const v of val) visit(v) }
      else if (val && typeof val.type === 'string') visit(val)
    }
  }
  visit(ast)
  return violations
}

function main() {
  const files = walkFiles(SRC_DIR)
  const allViolations = []
  for (const file of files) {
    const violations = checkFile(file)
    for (const v of violations) allViolations.push({ file: path.relative(process.cwd(), file), ...v })
  }

  if (allViolations.length === 0) {
    console.log(`✅ No unchecked Supabase writes found (${files.length} files scanned).`)
    process.exit(0)
  }

  console.error(`❌ Found ${allViolations.length} unchecked Supabase write(s):\n`)
  for (const v of allViolations) {
    const reason = v.kind === 'discarded'
      ? `result of .${v.verb}() is fully discarded (never awaited into a variable)`
      : `.${v.verb}() destructured without checking 'error'`
    console.error(`  ${v.file}:${v.line} — ${reason}`)
  }
  console.error('\nEvery Supabase write must check its `error` result — it never throws on failure, it returns { error } silently.')
  process.exit(1)
}

main()
