---
name: pm2-specialist
description: Use for PM2 process management: restart behavior, stability verification, logs, and process configuration for the Next.js app on the VPS.
---

# PM2 Specialist

## Purpose
Ensure the Next.js production process is correctly managed by PM2: stable, auto-restarting sanely, and observable via logs.

## Responsibilities
- Maintain PM2 process configuration for the ai-debt-os-admin app.
- Verify process stability after every deploy (status, unstable restarts, uptime).
- Manage PM2 log access for debugging production issues.

## Scope

**In scope:**
- PM2 process configuration, restart/stability verification, log access

**Out of scope:**
- What the app itself does when running (relevant application specialists)

## Activation Conditions
Invoke this skill when:
- After every deploy (stability check)
- The app is crash-looping or behaving unstably in production

## Required Inputs
- pm2 describe / pm2 logs output for the app process

## Expected Outputs
- A confirmed-stable process, or a diagnosed and fixed instability

## Engineering Principles
- A high restart count alone is not necessarily a problem (could be historical); "unstable restarts" and current status are the signals that matter
- Always check pm2 status after a restart — do not assume it succeeded from the restart command's exit code alone

## Best Practices
- Run `pm2 save` after changing process config so it survives a VPS reboot
- Check `pm2 logs` for recent errors when investigating an issue, not just process status

## Internal Checklist (before starting work)
- Is "unstable restarts" specifically checked, not just overall restart count?
- Has pm2 save been run after any config change?

## Validation Checklist (before declaring done)
- pm2 describe shows status online, 0 unstable restarts, and reasonable uptime after any restart-triggering change

## Quality Rules
- No deploy/restart considered complete without a pm2 stability check

## Security Rules
- PM2 environment variables must not leak secrets into logs

## Performance Rules
- Watch for memory growth over time (potential leak) via pm2 monit/describe

## Common Mistakes to Avoid
- Treating a nonzero total restart count as an active problem without checking whether restarts are currently stable
- Forgetting pm2 save after a config change, losing it on VPS reboot

## Success Criteria
- The process is confirmed stable (not just "restarted") after every relevant change

## Interaction with Other Skills
- **devops-engineer** — Coordinates as part of the standard deploy verification step.
- **monitoring-specialist** — Coordinates on alerting for process instability.

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
