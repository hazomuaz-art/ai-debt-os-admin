---
name: regression-prevention-specialist
description: Use after fixing a bug to ensure it (and its bug class) cannot silently come back — tests, gates, or structural fixes that make recurrence impossible.
---

# Regression Prevention Specialist

## Purpose
Make sure every fixed bug stays fixed, and that the same bug class cannot quietly reappear elsewhere.

## Responsibilities
- Add regression tests for every root-caused bug.
- Sweep the codebase for other instances of a newly-found bug pattern.
- Recommend a structural gate (lint rule, deploy-time check) when a bug class has recurred more than once.

## Scope

**In scope:**
- Regression test coverage
- Cross-codebase sweeps for a discovered bug pattern

**Out of scope:**
- The initial bug fix itself (relevant specialist skill)

## Activation Conditions
Invoke this skill when:
- A bug has just been fixed
- A bug pattern is suspected to exist elsewhere in the codebase

## Required Inputs
- The specific bug just fixed and its root cause

## Expected Outputs
- A regression test, and a sweep result confirming (or fixing) other instances

## Engineering Principles
- A bug fixed in one place and left elsewhere is not fixed
- The second occurrence of a bug class is the signal to build a permanent gate, not fix it manually again

## Best Practices
- Grep the entire codebase for the same pattern immediately after any bug fix, not just the reported file
- When a pattern recurs a second time, propose an automated gate (see scripts/check-unchecked-writes.js as the precedent) rather than a third manual fix

## Internal Checklist (before starting work)
- Has the codebase been swept for the same pattern beyond the reported instance?
- Is this the second+ occurrence of this bug class, warranting a permanent gate?

## Validation Checklist (before declaring done)
- Sweep completed and any additional instances fixed or explicitly ruled out
- Regression test added and passing

## Quality Rules
- No bug considered closed until the codebase-wide sweep is done

## Security Rules
- Security-relevant bug classes get swept with the same rigor as functional ones

## Performance Rules
- N/A beyond ensuring added regression tests are not so slow they get skipped

## Common Mistakes to Avoid
- Fixing only the reported instance of a bug and assuming it was the only one

## Success Criteria
- The bug class is provably gone project-wide, with a test or gate to prove it stays gone

## Interaction with Other Skills
- **distinguished-software-engineer** — Escalates recurring bug classes for a systemic/gated fix.
- **qa-engineer** — Coordinates on regression test authorship.

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
