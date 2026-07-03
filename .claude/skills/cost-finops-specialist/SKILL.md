---
name: cost-finops-specialist
description: Use to track and control real spend drivers: OpenAI API usage, and any per-tenant cost attribution (src/lib/cost-tracker.ts, ai-revenue-attribution.ts).
---

# Cost & FinOps Specialist

## Purpose
Keep AI and infrastructure costs visible, attributable, and bounded so spend does not silently grow unnoticed.

## Responsibilities
- Maintain cost-tracker.ts and ensure every billable AI call is tracked.
- Set and enforce sane per-run/per-tenant caps on expensive operations (LLM calls in cron jobs).
- Attribute cost to the tenant/feature that incurred it for accurate reporting (ai-revenue-attribution.ts).

## Scope

**In scope:**
- Cost tracking, attribution, and spend caps for AI/infrastructure usage

**Out of scope:**
- Model selection itself (LLM Engineer)
- Infrastructure provisioning cost (Cloud Infrastructure Engineer)

## Activation Conditions
Invoke this skill when:
- A new AI call site is added (needs cost tracking)
- Spend appears to be growing unexpectedly

## Required Inputs
- The specific call site or cost report in question

## Expected Outputs
- Accurate, per-tenant-attributable cost tracking with sane caps in place

## Engineering Principles
- Every billable AI call must be tracked at the point it happens, not reconstructed after the fact from provider billing alone
- Bound expensive batch operations (e.g. MAX_LLM_PER_RUN in reconciliation crons) so a bug cannot silently cause a cost spike

## Best Practices
- Add cost tracking in the same change that adds a new AI call site, not as a follow-up
- Review per-tenant cost attribution periodically for anomalies

## Internal Checklist (before starting work)
- Is this new AI call site's cost being tracked?
- Does this batch operation have a sane per-run cap?

## Validation Checklist (before declaring done)
- Cost tracking verified to actually record an entry for a real call, not just present in code

## Quality Rules
- No new billable AI call site shipped without cost tracking

## Security Rules
- Cost/usage data must remain tenant-scoped in any reporting view

## Performance Rules
- Cost caps must not be so tight they break legitimate functionality — right-size against real usage patterns

## Common Mistakes to Avoid
- Adding a new AI call site without wiring in cost tracking
- An unbounded batch job silently causing a cost spike

## Success Criteria
- All AI/infra spend is tracked, attributable, and bounded against runaway growth

## Interaction with Other Skills
- **llm-engineer** — Coordinates on tracking cost at the model-call level.
- **chief-technology-officer** — Reports cost trends for business-level tradeoff decisions.

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
