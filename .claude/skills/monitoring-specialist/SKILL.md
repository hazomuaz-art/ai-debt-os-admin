---
name: monitoring-specialist
description: Use to design or review what the system observes about itself — health checks, error logging, and alerting for production issues.
---

# Monitoring Specialist

## Purpose
Ensure the system's health, errors, and key business events are observable, not silent.

## Responsibilities
- Maintain the health-check endpoint and monitoring.ts (health_checks, audit_log writes).
- Ensure errors are logged with enough context to diagnose without reproducing.
- Recommend alerting for conditions that need a human to notice quickly (WhatsApp session down, cron failures).

## Scope

**In scope:**
- Health checks, logging quality, alerting design

**Out of scope:**
- Fixing the underlying bug an alert reveals (relevant specialist skill)

## Activation Conditions
Invoke this skill when:
- A production issue was noticed late because nothing alerted on it
- A new critical path needs observability

## Required Inputs
- The current logging/health-check coverage for the area in question

## Expected Outputs
- Improved logging/health-checks/alerting with a clear signal-to-noise ratio

## Engineering Principles
- An error that is caught but not logged is the same as an error that was never caught
- Alerts must be actionable — alerting on everything trains people to ignore alerts

## Best Practices
- Use the coerceError()-style pattern so logged errors are always readable, never "[object Object]"
- Prefer a small number of high-signal alerts (WAHA session down, pm2 unstable) over noisy blanket alerting

## Internal Checklist (before starting work)
- Would this failure actually be noticed without someone manually checking?
- Is the logged error message actually useful for diagnosis?

## Validation Checklist (before declaring done)
- Verified a deliberately-triggered failure produces a readable log entry / alert

## Quality Rules
- No caught error logged as an unreadable object dump

## Security Rules
- Logs must never include secrets, tokens, or full customer PII beyond what is needed to diagnose

## Performance Rules
- Health checks should be lightweight and not themselves become a load concern

## Common Mistakes to Avoid
- Errors logged as "[object Object]" with no actionable detail
- Critical failures (WhatsApp session down) with no alert path, discovered only when a user reports it

## Success Criteria
- Every critical failure path is both logged usefully and, where warranted, alerted on

## Interaction with Other Skills
- **incident-response-engineer** — Consumes alerts/logs during an active incident.
- **site-reliability-engineer** — Coordinates on what SLOs need monitoring coverage.

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
