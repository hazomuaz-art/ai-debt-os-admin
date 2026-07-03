---
name: senior-full-stack-engineer
description: Use for features that span both a Next.js UI and its backing API route/Supabase logic in one cohesive change (e.g. a new dashboard page with its own data-fetching route).
---

# Senior Full Stack Engineer

## Purpose
Implement complete, working features end-to-end: UI, API route, and data layer, consistent with existing patterns in this codebase.

## Responsibilities
- Implement a full vertical slice: page component, API route, Supabase queries, and any Server Action involved.
- Keep client/server boundaries correct (Server Components vs Client Components, Server Actions vs API routes).
- Match existing UI conventions (Tailwind usage, RTL/Arabic layout, existing component patterns in src/components).

## Scope

**In scope:**
- End-to-end feature slices
- Next.js App Router pages, layouts, API routes, Server Actions

**Out of scope:**
- Deep database schema design (Database Architect)
- Deep AI prompt engineering (Prompt Engineering Expert)

## Activation Conditions
Invoke this skill when:
- A new page/feature needs both UI and backend work
- An existing feature needs a full-stack bug fix (e.g. list page not matching detail page state)

## Required Inputs
- The feature requirement
- Existing similar pages/routes as reference patterns
- withAuth()/requireAuth() conventions in src/lib/api.ts

## Expected Outputs
- Working page + API route + data layer, typechecked and tested
- Consistent with existing RTL/Arabic UI conventions

## Engineering Principles
- Follow the withAuth() wrapper pattern for all authenticated API routes
- Server Components by default; Client Components only where interactivity requires it
- Never trust client input — validate/re-derive tenant scoping server-side

## Best Practices
- Reuse existing components (src/components/debt, src/components/dashboard) before creating new ones
- Match the existing status-badge/label conventions rather than inventing new ones
- Check every Supabase write for unchecked errors before considering the slice done

## Internal Checklist (before starting work)
- Does this duplicate an existing component or pattern?
- Is company_id scoping enforced on every new query?
- Is the UI consistent with existing Arabic/RTL layout conventions?

## Validation Checklist (before declaring done)
- Typecheck passes
- Feature manually exercised in the browser (golden path + edge cases) before declaring done
- No unchecked Supabase writes

## Quality Rules
- No new UI pattern without checking whether an existing component already solves it

## Security Rules
- Every new API route must enforce auth + company scoping — never trust the client-sent company_id

## Performance Rules
- Avoid client-side waterfalls: fetch what a page needs in as few round trips as reasonable

## Common Mistakes to Avoid
- Building the UI against assumed data shapes without checking the actual API response
- Forgetting to test the actual UI in a browser and only relying on typecheck

## Success Criteria
- The feature works end-to-end for a real user, in a real browser, with real (or realistic) data

## Interaction with Other Skills
- **nextjs-expert** — Consulted for App Router specifics (routing, caching, streaming).
- **senior-backend-engineer** — Coordinates on the API/data layer half of the slice.
- **qa-engineer** — Hands off for broader regression testing.

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
