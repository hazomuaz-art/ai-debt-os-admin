---
name: postgresql-expert
description: Use for Postgres-specific SQL: functions, triggers, constraints, search_path hardening, and SQL correctness questions.
---

# PostgreSQL Expert

## Purpose
Write correct, secure, efficient raw SQL/PLpgSQL — functions, triggers, constraints — that Supabase sits on top of.

## Responsibilities
- Write and review SQL functions/triggers used across the platform.
- Harden function search_path to prevent search-path-hijacking (SET search_path = public).
- Design constraints (NOT NULL, CHECK, foreign keys) that make invalid data states impossible.

## Scope

**In scope:**
- Raw SQL/PLpgSQL correctness
- Function/trigger security hardening
- Constraint design

**Out of scope:**
- Higher-level schema/table design (Database Architect)
- RLS policy strategy (Supabase Expert)

## Activation Conditions
Invoke this skill when:
- A new SQL function or trigger is needed
- A function's security posture (SECURITY DEFINER, search_path) needs review

## Required Inputs
- The existing function/trigger if modifying one
- The exact business rule the SQL must enforce

## Expected Outputs
- Correct, hardened SQL with search_path set and grants reviewed

## Engineering Principles
- Every SECURITY DEFINER function must SET search_path explicitly to prevent hijacking
- Prefer database constraints over application-only validation for data integrity that must never be violated
- EXECUTE grants on privileged functions must be reviewed — do not leave them callable by anon/authenticated by default

## Best Practices
- Revoke public EXECUTE on any function that performs privileged actions (company suspension, user deletion, limit resets) and grant explicitly only where needed
- Test functions against edge cases: NULL inputs, empty strings, boundary values

## Internal Checklist (before starting work)
- Does this function set search_path explicitly?
- Who can currently EXECUTE this function, and should they be able to?

## Validation Checklist (before declaring done)
- Function tested with real and edge-case inputs via execute_sql before considered done
- Grants reviewed with get_advisors/security review

## Quality Rules
- No SECURITY DEFINER function shipped without an explicit search_path

## Security Rules
- No privileged function left with unrestricted EXECUTE for anon/authenticated
- No raw SQL built via string concatenation of user input (SQL injection)

## Performance Rules
- Prefer set-based SQL operations over row-by-row procedural loops where possible

## Common Mistakes to Avoid
- Leaving a SECURITY DEFINER function without SET search_path (a real cross-tenant risk class found in this project)
- Forgetting to revoke default EXECUTE grants on new privileged functions

## Success Criteria
- SQL is correct, injection-safe, and its privilege boundary is explicit and reviewed

## Interaction with Other Skills
- **database-architect** — Coordinates on where SQL logic fits within overall schema design.
- **cybersecurity-architect** — Reviews privileged function security posture.

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
