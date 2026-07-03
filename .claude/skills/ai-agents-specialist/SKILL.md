---
name: ai-agents-specialist
description: Use for the WhatsApp collector agent's end-to-end decision logic: what it says, when it escalates, when it pauses, and how it reacts to each customer message.
---

# AI Agents Specialist

## Purpose
Own the correctness of the AI collector agent's decision-making end-to-end (src/lib/ai-collector-agent.ts, automation-pipeline.ts).

## Responsibilities
- Ensure the agent reacts to the customer's real message, never its own prior reply mistaken for customer input.
- Own escalation logic: disputes, payment claims, legal escalation, large-settlement approvals.
- Ensure the agent respects conversation gates (opt-outs, cooldowns, ai_paused state).

## Scope

**In scope:**
- End-to-end collector agent decision logic
- Escalation/approval trigger conditions

**Out of scope:**
- Prompt wording (Prompt Engineering Expert)
- Raw AI API integration plumbing (AI Engineer)

## Activation Conditions
Invoke this skill when:
- The agent's behavior in a real conversation is wrong (misclassification, wrong escalation, missed dispute)
- A new escalation/approval type is being added

## Required Inputs
- The full message pipeline path from webhook to action
- Existing escalation/approval conventions

## Expected Outputs
- Correct end-to-end agent behavior verified against real conversation examples

## Engineering Principles
- The pipeline must always process the customer's actual inbound message content, never the agent's own generated reply
- Escalation paths must have a single source of truth per type — do not let two code paths create duplicate approvals for the same event
- Respect ai_paused / conversation-gate state as a hard stop before generating any reply

## Best Practices
- Trace a real conversation transcript end-to-end through the pipeline when debugging agent behavior, not just unit-level logic
- Add cooldown/dedup guards to any escalation trigger that could otherwise fire repeatedly for the same underlying event

## Internal Checklist (before starting work)
- Is the pipeline reading the customer's real message, confirmed by tracing the actual webhook payload?
- Could this escalation trigger create a duplicate of one already created elsewhere?

## Validation Checklist (before declaring done)
- Verified against at least one real recent conversation with a known correct outcome
- No duplicate approval/escalation created for the same underlying event

## Quality Rules
- No agent decision path shipped without being traced against a real conversation, not just synthetic input

## Security Rules
- Agent actions with real-world effect (messages sent, status changes, approvals) must remain tenant-scoped

## Performance Rules
- Avoid redundant AI calls within a single message-processing pass

## Common Mistakes to Avoid
- Feeding the agent's own reply back into the classifier as customer intent (the actual root cause of a real misclassification bug this session)
- Two independent code paths each creating an approval for the same event (duplicate dispute-approval bug found and fixed this session)

## Success Criteria
- The agent's behavior is verified correct against real, specific historical conversations — not just plausible in the abstract

## Interaction with Other Skills
- **ai-architect** — Aligns agent behavior with the overall AI/deterministic boundary.
- **ai-memory-specialist** — Depends on accurate context/memory for correct decisions.
- **automation-engineer** — Coordinates on the broader automation pipeline the agent runs within.
- **whatsapp-integration-expert** — Coordinates on the transport layer feeding the agent.

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
