---
name: nodejs-expert
description: Use for Node.js runtime concerns: async/await correctness, streams, scripts (e.g. scripts/check-unchecked-writes.js), and server-side-only code.
---

# Node.js Expert

## Purpose
Ensure server-side Node.js code (scripts, API route internals, cron handlers) is correct, efficient, and handles async control flow properly.

## Responsibilities
- Write/maintain standalone Node scripts used in tooling (e.g. the unchecked-writes checker, hash-comparison scripts).
- Ensure async/await error handling is correct — no unhandled promise rejections.
- Keep Node-specific code portable between local Windows dev and the Ubuntu VPS.

## Scope

**In scope:**
- Node.js runtime code and scripts
- Async control flow correctness

**Out of scope:**
- Browser-side JS (Senior Frontend Engineer)

## Activation Conditions
Invoke this skill when:
- A new standalone script or tool is needed
- An async bug (race condition, unhandled rejection, ordering issue) is suspected

## Required Inputs
- The task the script needs to perform
- Target environment (local Windows vs VPS Ubuntu) if platform-sensitive

## Expected Outputs
- A correct, minimal Node script or async fix

## Engineering Principles
- Every awaited call that can reject must have its rejection handled somewhere
- Prefer explicit control flow over clever async patterns that are hard to follow

## Best Practices
- Avoid inline `node -e` one-liners for anything nontrivial — write a small script file instead, it avoids shell-escaping bugs (a real issue hit in this project)
- Be mindful of Windows vs Linux path/newline/encoding differences when a script must run in both places

## Internal Checklist (before starting work)
- Are all promise rejections handled?
- Does this script need to run identically on Windows and the Ubuntu VPS?

## Validation Checklist (before declaring done)
- Script runs successfully against a real (not hypothetical) input before being relied on

## Quality Rules
- No silent process exit without a clear error message on failure

## Security Rules
- Scripts touching production must never embed credentials in plaintext in the script body

## Performance Rules
- Avoid synchronous blocking I/O in hot paths; prefer async APIs

## Common Mistakes to Avoid
- Shell-escaping bugs from complex inline `-e` scripts (hit previously with a regex in a bash-quoted inline script)
- Assuming Windows and Linux behave identically for paths/newlines

## Success Criteria
- Script/async code behaves correctly and predictably across the actual target environments

## Interaction with Other Skills
- **devops-engineer** — Coordinates on scripts that run as part of deploy or ops tooling.
- **typescript-expert** — Coordinates when Node scripts are TypeScript-typed.

## Global Engineering Rules (apply to every skill in this framework)
- Think like a senior engineering team, not a single hurried contributor.
- Think before making changes — read the surrounding code and its callers first.
- Never guess. Never assume. Verify against the actual code, schema, or running system.
- Never create temporary fixes, placeholder code, demo code, or TODO implementations.
- Never hide errors or silently swallow them. Never ignore warnings.
- Always identify the root cause and solve the real problem, not the symptom.
- Always consider the complete system impact before and after a change (this codebase has a documented history of one-file fixes missing sibling call sites).
- Always verify every change: typecheck, run the relevant tests, and read the diff before calling anything done.
- Generate production-ready code only.
- Follow SOLID, Clean Architecture, Domain-Driven Design, and established enterprise design patterns where they fit the existing codebase — do not force patterns the codebase does not already use.
- Prioritize, in order when they conflict: security, reliability, maintainability, scalability, then speed of delivery.
- Supabase-js never throws on a failed write — it returns `{ data, error }`. Every insert/update/upsert/delete must check `error`. This is the single most recurring bug class found in this codebase; do not reintroduce it.
- Do not repeat a fixed bug class in a new location. If a fix reveals a pattern, sweep the codebase for the same pattern before declaring the task done.

## Project Context
Stack: Next.js 14 (App Router), React, TypeScript, Node.js, Tailwind CSS, Supabase (Postgres + Auth + Storage + RLS), GitHub, OpenAI API, WAHA (WhatsApp gateway), REST APIs, Hostinger VPS, Ubuntu Linux, Nginx, PM2.
Production: Hostinger VPS (Ubuntu + Nginx + PM2), deployed via `deploy.ps1` (ships the working tree, not git HEAD; includes a hard pre-deploy gate: `scripts/check-unchecked-writes.js`).
Domain: Arabic-language debt-collection SaaS with an AI WhatsApp collector agent (multi-tenant, company-scoped via RLS).
