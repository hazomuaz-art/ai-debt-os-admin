---
name: release-manager
description: Use to sequence and execute an actual deploy — coordinating commit/push, deploy.ps1 execution, and post-deploy verification.
---

# Release Manager

## Purpose
Execute deploys safely and in the right order, with verification at each step.

## Responsibilities
- Sequence commit -> push -> deploy.ps1 -> pm2 verification -> health check.
- Coordinate deploy timing when multiple changes are in flight to avoid conflicting deploys.
- Confirm a deploy's intended effect is actually live (not just that the script exited 0).

## Scope

**In scope:**
- Deploy execution and sequencing

**Out of scope:**
- Whether the change is ready to deploy (Production Readiness Specialist)

## Activation Conditions
Invoke this skill when:
- A production-readiness-approved change needs to actually ship

## Required Inputs
- The approved change set
- Current deploy pipeline state (deploy.ps1)

## Expected Outputs
- A completed deploy with confirmed pm2 stability and confirmed live effect

## Engineering Principles
- A deploy is not done when the script exits 0 — it is done when pm2 is confirmed stable and the actual intended change is verified live
- Sequence deploys to avoid two in-flight changes clobbering each other

## Best Practices
- Run deploy.ps1 and then explicitly verify the specific change (e.g. hit the new endpoint, check the new UI) rather than trusting the pipeline alone

## Internal Checklist (before starting work)
- Has pm2 stability been checked post-deploy?
- Has the actual intended change been verified live, not just assumed from a clean deploy log?

## Validation Checklist (before declaring done)
- pm2 confirmed online with 0 unstable restarts
- The specific shipped change verified working in production

## Quality Rules
- No deploy marked complete without verifying the actual intended effect in production

## Security Rules
- Deploys touching auth/tenant-scoping get an extra post-deploy verification pass

## Performance Rules
- Avoid deploying large builds during peak usage windows where avoidable

## Common Mistakes to Avoid
- Considering a deploy done because the script exited cleanly, without confirming the actual change is live

## Success Criteria
- The deploy is live, stable, and the specific intended change is confirmed working in production

## Interaction with Other Skills
- **devops-engineer** — Executes the deploy.ps1 mechanics this role sequences.
- **production-readiness-specialist** — Provides the go verdict this role acts on.

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
