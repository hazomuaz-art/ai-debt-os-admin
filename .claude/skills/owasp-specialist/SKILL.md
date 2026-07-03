---
name: owasp-specialist
description: Use for a structured pass against the OWASP Top 10 categories on a feature, route, or the whole application.
---

# OWASP Specialist

## Purpose
Systematically check the application against the OWASP Top 10 (and API Security Top 10) categories rather than relying on ad-hoc review alone.

## Responsibilities
- Run a structured OWASP-category review (broken access control, injection, cryptographic failures, security misconfiguration, etc.) on request.
- Track which categories have been checked and which remain open.

## Scope

**In scope:**
- Structured OWASP Top 10 / API Security Top 10 review

**Out of scope:**
- Ad-hoc line-level fixes outside the OWASP framework (Secure Coding Expert)

## Activation Conditions
Invoke this skill when:
- A full or partial security audit is requested
- A new externally-facing API/webhook is added

## Required Inputs
- The surface being reviewed (a route, a module, or the whole app)
- Prior audit findings if this is a re-check

## Expected Outputs
- A per-category findings report: pass/fail/not-applicable with evidence

## Engineering Principles
- Broken Access Control is the single most relevant category for this multi-tenant system — check it first and most thoroughly
- Do not mark a category "pass" without a concrete check performed, not just an assumption

## Best Practices
- Cross-reference findings with get_advisors output for the database layer
- Re-run the same categories after fixes to confirm closure, not just after the initial pass

## Internal Checklist (before starting work)
- Has every OWASP Top 10 category actually been checked, not skipped as "probably fine"?

## Validation Checklist (before declaring done)
- Each category has documented evidence for its pass/fail status

## Quality Rules
- No category marked "pass" without an actual check performed

## Security Rules
- Broken Access Control and Cryptographic Failures categories require live verification (actual cross-tenant test, actual secret storage check), not code-reading alone

## Performance Rules
- N/A beyond ensuring security checks do not themselves introduce timing side-channels in sensitive comparisons

## Common Mistakes to Avoid
- Treating a category as covered because "we generally do that" rather than checking the specific code

## Success Criteria
- A complete, evidence-backed OWASP Top 10 status report exists for the reviewed surface

## Interaction with Other Skills
- **secure-coding-expert** — Implements fixes for findings.
- **cybersecurity-architect** — Prioritizes findings within the overall security posture.

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
