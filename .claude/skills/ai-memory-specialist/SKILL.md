---
name: ai-memory-specialist
description: Use for anything about how conversation/customer context is retained and retrieved across turns — case-note summaries, message history windows, customer_id/debt_id scoping for context queries.
---

# AI Memory Specialist

## Purpose
Ensure the AI system correctly remembers and retrieves the right amount of the right context, and correctly identifies what has already been said.

## Responsibilities
- Own case-note summarization logic (src/lib/case-note.ts) as the system's durable working memory of a debt.
- Ensure message-history queries scope correctly by customer_id with debt_id-null fallback (a structural gap found and fixed this session).
- Own anti-repetition logic so the agent does not repeat itself across the full outbound history.

## Scope

**In scope:**
- Conversation memory retrieval and summarization
- Context-window scoping correctness

**Out of scope:**
- Vector/embedding-based retrieval architecture (RAG Specialist)
- Prompt wording (Prompt Engineering Expert)

## Activation Conditions
Invoke this skill when:
- The agent appears to forget or repeat itself
- Case-note content is inaccurate, stale, or overly verbose
- A context query is scoped incorrectly (missing messages sent before debt_id was set)

## Required Inputs
- The actual message/customer/debt data being queried
- Existing case-note/anti-repetition query patterns

## Expected Outputs
- Correctly-scoped memory queries and accurate, appropriately-terse summaries

## Engineering Principles
- A null debt_id on early messages must not silently drop them from context — scope by customer_id with a debt_id-is-null fallback
- Case-note should reflect the latest development/current state, not a growing full transcript
- Anti-repetition checks must see the full relevant outbound history, not a truncated recent slice

## Best Practices
- When fixing a context-scoping bug in one place (classifier, case-note, or anti-repetition), check the other two — they share the same query pattern and the same historical bug
- Verify case-note freshness by checking it against the actual latest message, not assuming the update fired

## Internal Checklist (before starting work)
- Does this context query handle messages with a null debt_id?
- Is the summary reflecting current state or accumulating history?

## Validation Checklist (before declaring done)
- Tested against a real customer whose debt_id was null on early messages
- Case-note update write result checked for error, not just fired-and-forgotten

## Quality Rules
- No context query that silently excludes valid historical messages due to a schema nullability gap

## Security Rules
- Context queries must remain company/tenant-scoped even when using customer_id-based fallback logic

## Performance Rules
- Cap history window size sensibly (e.g. last 8 messages) rather than loading unbounded history per call

## Common Mistakes to Avoid
- Scoping context queries only by debt_id, silently losing pre-debt-resolution messages
- Letting case-note grow into a full transcript instead of staying a terse current-state summary

## Success Criteria
- The agent has accurate, complete, appropriately-sized memory of each conversation, verified against real customer data

## Interaction with Other Skills
- **ai-agents-specialist** — Coordinates on how memory feeds the collector agent's decisions.
- **database-architect** — Coordinates on schema fixes for structural context-loss gaps (e.g. nullable debt_id).

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
