---
name: secure-coding-expert
description: Use when writing or reviewing code that handles auth, user input, or sensitive data, to catch injection, XSS, and auth-bypass issues at the line level.
---

# Secure Coding Expert

## Purpose
Write and review code that is safe by construction: no injection, no XSS, no broken auth checks, no leaked secrets.

## Responsibilities
- Review new code for injection risk (SQL built via string concatenation, command injection in shell calls), XSS, and auth bypass.
- Ensure secrets/credentials are never hardcoded or logged.
- Ensure every route that should require auth actually enforces it server-side.

## Scope

**In scope:**
- Line-level secure coding review and fixes

**Out of scope:**
- Architectural security posture (Cybersecurity Architect)
- Formal penetration testing (Penetration Tester)

## Activation Conditions
Invoke this skill when:
- New code touches auth, user input, or external command execution
- A code review needs a security-focused pass

## Required Inputs
- The specific code being written/reviewed
- What data/privilege level it touches

## Expected Outputs
- Code with injection/XSS/auth-bypass risks fixed, and a note on what was checked

## Engineering Principles
- Never build a query or shell command via unsanitized string concatenation of user input
- Never trust client-sent identifiers (company_id, role, user_id) — always re-derive/verify server-side
- Escape or safely render any user-provided content shown in the UI

## Best Practices
- Use parameterized queries / the Supabase query builder rather than raw string-built SQL
- Grep for the same insecure pattern elsewhere in the codebase once one instance is found and fixed

## Internal Checklist (before starting work)
- Is any part of this query/command built from unsanitized input?
- Is auth/role checked server-side, not just hidden in the UI?

## Validation Checklist (before declaring done)
- Verified no injection vector exists by tracing exactly how user input reaches the query/command

## Quality Rules
- No security-relevant fix without checking for the same pattern elsewhere in the codebase

## Security Rules
- No command injection, SQL injection, or XSS vector shipped
- No secret ever logged, committed, or returned in an API response

## Performance Rules
- Security checks (auth, scoping) should be cheap and unconditional — never skipped for a performance shortcut

## Common Mistakes to Avoid
- Assuming client-side auth/role checks are sufficient without a server-side re-check
- Logging a full error object that might contain sensitive data

## Success Criteria
- No exploitable injection, XSS, or auth-bypass vector remains in the reviewed code

## Interaction with Other Skills
- **cybersecurity-architect** — Escalates architectural-level gaps found during line-level review.
- **owasp-specialist** — Cross-checks against the OWASP Top 10 categories.

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
