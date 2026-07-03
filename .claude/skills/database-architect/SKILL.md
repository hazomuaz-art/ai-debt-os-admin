---
name: database-architect
description: Use for schema design, new tables/columns, relationships, indexing strategy, and migration planning.
---

# Database Architect

## Purpose
Design a correct, normalized, well-indexed schema that supports multi-tenant isolation and the product's actual query patterns.

## Responsibilities
- Design new tables/columns and their relationships.
- Own migration file authorship and sequencing (supabase/migrations/*.sql).
- Ensure every tenant-scoped table has company_id and appropriate RLS policies.
- Plan indexes for known high-traffic query patterns.

## Scope

**In scope:**
- Schema design
- Migration authorship
- Indexing strategy
- RLS policy design

**Out of scope:**
- Query-level optimization of existing schema (Query Optimization Expert)
- Application-level data-access code (Senior Backend Engineer)

## Activation Conditions
Invoke this skill when:
- A new table/column is needed
- A schema change is needed to fix a structural bug (e.g. the debt_id nullability gap)

## Required Inputs
- The actual current live schema (not just local migration files — this project has had drift between them)
- The access patterns the new schema must support

## Expected Outputs
- A migration file, applied and verified live, with a mirrored local file
- RLS policies for any new tenant-scoped table

## Engineering Principles
- Every tenant-scoped table needs company_id + RLS enforcing it
- Prefer NOT NULL with a sane default over nullable-by-convenience — nullable foreign keys have caused real context-loss bugs in this codebase (debt_id on messages)
- Migrations are additive and forward-only in production; do not hand-edit history

## Best Practices
- Apply migrations via the Supabase MCP tool live, and mirror the file locally in the same change — do not let them drift
- Add a SELECT policy for any table with RLS enabled — a table with RLS on and zero policies denies all access silently (a real bug found this session)
- Use STABLE SQL functions like get_user_company_id() in RLS policies rather than bare auth.uid() where perf matters

## Internal Checklist (before starting work)
- Does every new table have company_id and RLS?
- Does the live schema already differ from what I expect? (verify, do not assume)
- Is a NOT NULL constraint being avoided for convenience rather than a real reason?

## Validation Checklist (before declaring done)
- Migration applied live and confirmed via list_migrations/list_tables
- RLS policies tested against a non-owning tenant to confirm isolation
- Local migration file matches what was actually applied

## Quality Rules
- No migration file created locally without also being applied and confirmed live, and vice versa

## Security Rules
- No new table with RLS enabled and zero policies (silent deny-all is a bug, not safety)
- No SECURITY DEFINER function without an explicit, reviewed EXECUTE grant policy

## Performance Rules
- Index foreign keys and columns used in frequent WHERE/JOIN/ORDER BY clauses
- Avoid redundant overlapping RLS policies that force per-row re-evaluation

## Common Mistakes to Avoid
- Local migrations folder drifting out of sync with the live database (a real, previously-discovered issue in this project)
- Adding RLS without a SELECT policy, silently locking out legitimate access
- Nullable foreign keys chosen for short-term convenience causing long-term context loss

## Success Criteria
- Schema changes are live, locally mirrored, tenant-isolated, and indexed appropriately

## Interaction with Other Skills
- **postgresql-expert** — Consulted for Postgres-specific implementation details.
- **supabase-expert** — Coordinates on RLS policy design and Supabase-specific tooling.
- **query-optimization-expert** — Hands off for query-level performance tuning after schema is set.

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
