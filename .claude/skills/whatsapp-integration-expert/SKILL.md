---
name: whatsapp-integration-expert
description: Use for anything involving the WAHA WhatsApp gateway: session connectivity, inbound webhook processing, and outbound send logic.
---

# WhatsApp Integration Expert

## Purpose
Own the WhatsApp transport layer end-to-end: the WAHA gateway, session health, inbound message ingestion, and outbound sends.

## Responsibilities
- Maintain the waha-webhook inbound handler and the outbound send logic (src/lib/whatsapp.ts).
- Monitor and diagnose WAHA session connectivity (session down = agent cannot send/receive at all).
- Ensure the inbound handler always passes the customer's actual message content into the pipeline, never the agent's own prior reply.

## Scope

**In scope:**
- WAHA gateway session management, inbound/outbound WhatsApp message handling

**Out of scope:**
- What the agent decides to say (AI Agents Specialist)
- Non-WhatsApp integrations (Integration Engineer)

## Activation Conditions
Invoke this skill when:
- A WAHA session is down or misbehaving
- A message is dropped, duplicated, or its content is misrouted into the pipeline

## Required Inputs
- The actual WAHA webhook payload
- Current WAHA session status

## Expected Outputs
- A correctly-processed inbound message or a diagnosed/fixed session issue

## Engineering Principles
- The inbound pipeline must process the real customer message text, never an AI-generated reply mistaken for it — this was a real, confirmed root cause of a misclassification bug
- A down WAHA session is a full outage for the collection channel and should be treated with urgency
- Re-scanning a QR code / re-establishing a session is a user action that must be flagged clearly, not silently worked around

## Best Practices
- Check WAHA session status directly (not just assume from app-level symptoms) when messages seem to stop flowing
- Verify the exact field being read from the webhook payload matches what WAHA actually sends for customer-authored messages

## Internal Checklist (before starting work)
- Is the pipeline definitely reading the customer's real message field, confirmed against an actual payload?
- Is the WAHA session currently connected?

## Validation Checklist (before declaring done)
- Verified against a real, current webhook payload, not an assumed/old schema

## Quality Rules
- No inbound-processing change shipped without confirming which payload field actually holds the customer's message

## Security Rules
- Webhook payloads must be tied to the correct company/tenant before any processing

## Performance Rules
- Process inbound webhooks quickly; defer heavy AI/DB work appropriately so WAHA does not time out and retry

## Common Mistakes to Avoid
- Feeding the agent's own generated reply back into the classifier as if it were the customer's message (the exact root cause of a real bug this session)
- Not noticing a WAHA session is down until a user reports messages have stopped

## Success Criteria
- Inbound/outbound WhatsApp flow is correct, and session health is actively known, not discovered by user complaint

## Interaction with Other Skills
- **ai-agents-specialist** — Feeds the agent the correctly-sourced customer message.
- **monitoring-specialist** — Coordinates on alerting for session-down conditions.

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
