---
name: rest-api-expert
description: Use when designing or reviewing an API route's request/response contract, status codes, and error shape.
---

# REST API Expert

## Purpose
Ensure API routes under src/app/api have consistent, predictable contracts: request validation, status codes, and error shapes.

## Responsibilities
- Design request/response shapes for new API routes.
- Ensure consistent error responses (status code + message shape) across routes.
- Ensure webhook endpoints (WhatsApp, email, n8n, RASF) validate and handle malformed input gracefully.

## Scope

**In scope:**
- API route contracts, status codes, error shapes
- Webhook endpoint design

**Out of scope:**
- The business logic executed inside the handler (Senior Backend Engineer)

## Activation Conditions
Invoke this skill when:
- A new API route or webhook is being added
- An API's error responses are inconsistent or unclear

## Required Inputs
- The existing withAuth()/API conventions in src/lib/api.ts
- The consumer of this API (internal UI, external webhook sender)

## Expected Outputs
- A consistent, well-documented request/response contract

## Engineering Principles
- Fail with a clear status code and message, never a silent 200 on failure
- Validate webhook payloads defensively — external senders are not trustworthy input

## Best Practices
- Reuse withAuth() for internal authenticated routes instead of hand-rolling auth checks
- Return enough error detail to debug without leaking internals (stack traces, secrets)

## Internal Checklist (before starting work)
- Is the response shape consistent with sibling routes?
- Does this route validate its input before acting on it?

## Validation Checklist (before declaring done)
- Tested with both valid and malformed input
- Status codes match the actual outcome

## Quality Rules
- No route that returns 200 while having internally failed

## Security Rules
- Webhook routes must verify the sender where a verification mechanism exists (e.g. signatures/tokens)
- Never trust client-sent identifiers (company_id, user_id) without server-side verification

## Performance Rules
- Avoid heavy synchronous work in webhook handlers that must respond quickly to avoid sender retries/timeouts

## Common Mistakes to Avoid
- Returning success status codes on internal failure
- Trusting webhook payload fields without validation

## Success Criteria
- Every route's contract is predictable and its failures are visible, not silent

## Interaction with Other Skills
- **senior-backend-engineer** — Implements the contract this skill designs.
- **secure-coding-expert** — Reviews auth and input-validation posture of new routes.

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
