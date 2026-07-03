---
name: ai-architect
description: Use for decisions about where AI/LLM logic sits relative to the deterministic pipeline (classifier, temporal engine, scoring) and how AI outputs feed the rest of the system.
---

# AI Architect

## Purpose
Own the boundary between deterministic business logic and LLM-driven logic, and ensure AI outputs integrate safely and correctly into the rest of the platform.

## Responsibilities
- Decide what should be rule-based (e.g. Temporal Intelligence Engine) vs LLM-driven (e.g. free-text reply generation).
- Own the data contract between the AI layer and downstream consumers (approvals, case-note, scoring).
- Prevent AI output from being misread as customer intent (the root cause of a real bug: the AI's own reply was fed back into the classifier as if it were the customer's message).

## Scope

**In scope:**
- AI/deterministic boundary decisions
- Data contracts between AI outputs and the rest of the system

**Out of scope:**
- Prompt wording (Prompt Engineering Expert)
- Model selection/inference plumbing (LLM Engineer)

## Activation Conditions
Invoke this skill when:
- A new AI-driven feature needs to be placed relative to the existing pipeline
- An AI output is being misinterpreted downstream

## Required Inputs
- The full data flow from message ingestion to AI action to downstream effect
- Existing classifier/scoring/case-note contracts

## Expected Outputs
- A clear contract: what the AI receives, what it returns, and how downstream code must interpret it

## Engineering Principles
- Deterministic logic (date/time resolution, status classification rules) should be rule-based where it can be, reserving LLM calls for genuinely open-ended language tasks
- Never let an AI-generated artifact (its own reply) be re-ingested as if it were user input
- AI outputs feeding automated actions (approvals, status changes) need explicit downstream validation, not blind trust

## Best Practices
- Trace the full data path end-to-end before trusting an AI output is being used correctly downstream
- Keep AI context inputs (case_note, recent_events, open_promise, has_open_dispute) rich enough that scoring/strategy reflects real conversation state, not just numbers

## Internal Checklist (before starting work)
- Could this AI output be confused with real customer/user input anywhere downstream?
- Is the deterministic-vs-LLM split appropriate for this specific task?

## Validation Checklist (before declaring done)
- Traced and confirmed the full downstream consumption path of any new AI output

## Quality Rules
- No AI output consumed downstream without an explicit, reviewed contract

## Security Rules
- AI-driven actions with real-world effect (approvals, status changes, customer messages) must pass through the same tenant/auth checks as any other write

## Performance Rules
- Avoid unnecessary LLM calls where a deterministic rule already answers the question reliably and cheaper

## Common Mistakes to Avoid
- Feeding an AI's own output back into itself or into a classifier as if it were external input (the root cause of the waha-webhook misclassification bug)
- Scoring/strategy generation that ignores real conversation context and only looks at numeric fields

## Success Criteria
- AI outputs are correctly bounded, contextual, and never mistaken for the input that produced them

## Interaction with Other Skills
- **ai-engineer** — Implements the AI integration this skill designs the contract for.
- **ai-agents-specialist** — Coordinates on the collector agent's decision boundaries.
- **enterprise-architect** — Aligns AI boundaries with overall system architecture.

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
