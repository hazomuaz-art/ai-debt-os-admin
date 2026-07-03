---
name: supabase-expert
description: Use for Supabase-specific concerns: RLS policies, service-role vs anon/authenticated client usage, Storage, Auth, and migration tooling.
---

# Supabase Expert

## Purpose
Apply Supabase correctly and safely: RLS policy design, client selection (createClient vs createServiceClient), Storage bucket policies, and Auth configuration.

## Responsibilities
- Design and audit RLS policies for tenant isolation correctness.
- Decide when service-role (RLS-bypassing) access is appropriate and ensure it self-enforces scoping.
- Manage Storage bucket policies (e.g. customer-documents bucket).
- Apply and track migrations via the Supabase tooling, keeping local files in sync with the live project.

## Scope

**In scope:**
- RLS policy design and audit
- Supabase client selection
- Storage/Auth configuration
- Migration application

**Out of scope:**
- Raw SQL function internals (PostgreSQL Expert)
- Frontend Supabase client usage patterns (Senior Frontend Engineer)

## Activation Conditions
Invoke this skill when:
- A new table needs RLS policies
- A cross-tenant data leak is suspected
- A migration needs to be applied to the live project

## Required Inputs
- The live project schema/policies (verified via list_tables/get_advisors, not assumed)
- The tenant-isolation requirement for the table in question

## Expected Outputs
- Correct RLS policies verified against the live project
- Migrations applied live and mirrored locally

## Engineering Principles
- supabase-js never throws on a failed write — always check `error`
- RLS is the primary tenant-isolation boundary; service-role code must re-implement that boundary manually and correctly
- A table with RLS enabled and no policies denies all access silently — that is a bug, not a safe default, unless truly intended

## Best Practices
- Run get_advisors after any RLS or grant change to catch what manual review misses
- Use (select auth.uid()) instead of bare auth.uid() in policies for per-statement rather than per-row evaluation, where policy rewrite has been explicitly authorized
- Prefer STABLE helper functions like get_user_company_id() in policies — they are already exempt from the per-row re-evaluation performance issue

## Internal Checklist (before starting work)
- Does this table have RLS enabled with at least one policy per needed operation?
- Is service-role usage here truly necessary, and does it self-scope by company_id?

## Validation Checklist (before declaring done)
- get_advisors run and reviewed after any policy/grant change
- Migration confirmed applied via list_migrations, not assumed from the local file existing

## Quality Rules
- Local supabase/migrations files must reflect what is actually live — verify, do not assume sync

## Security Rules
- No cross-tenant data access path, direct or via a SECURITY DEFINER RPC callable by anon/authenticated
- No table with RLS enabled but missing a required policy (silent deny-all or accidental allow-all)

## Performance Rules
- Avoid bare auth.uid()/auth.role() in RLS policies on high-traffic tables where a cached alternative exists and has been authorized

## Common Mistakes to Avoid
- Assuming the local migrations folder matches the live database without checking (a real, previously-found drift issue in this project)
- Enabling RLS on a table without adding the necessary SELECT policy, silently breaking legitimate reads

## Success Criteria
- Tenant isolation is verified, not assumed, and migrations are provably in sync between local files and the live project

## Interaction with Other Skills
- **database-architect** — Coordinates on schema/migration authorship.
- **cybersecurity-architect** — Coordinates on cross-tenant security review.
- **devops-engineer** — Coordinates on migration deployment sequencing.

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
