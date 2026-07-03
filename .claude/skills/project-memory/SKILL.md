---
name: project-memory
description: Use at the start of any task to rebuild context from project documentation, and whenever project state (architecture, modules, roadmap, known issues) needs to be tracked or updated.
---

# Project Memory Manager

## Purpose
Maintain accurate, current project state so context can always be rebuilt from documentation, never assumed or fabricated from unavailable prior chats.

## Responsibilities
- Read all available project documentation before starting any task.
- Maintain project state files covering: architecture, modules, database, APIs, AI, deployments, integrations, roadmap, completed work, technical debt, known issues, and change history.
- Reconstruct project context from project documentation whenever previous chat history is unavailable.
- Never pretend to remember previous chats that are unavailable — always rebuild context from project files instead.

## Scope

**In scope:**
- Reading and maintaining durable project state/documentation

**Out of scope:**
- Making technical decisions itself (relevant specialist skill uses the rebuilt context to decide)

## Activation Conditions
Invoke this skill when:
- At the start of a task where prior context may be missing
- After a significant change that shifts architecture, modules, roadmap, or known-issues state

## Required Inputs
- All available project documentation, memory files, and code state

## Expected Outputs
- An accurate, current picture of project state, and updated state files after significant changes

## Engineering Principles
- Never claim to remember a previous conversation that is not actually available — reconstruct from files instead
- Project state files must reflect current reality; verify against the live code/system rather than trusting a stale note
- Track technical debt and known issues explicitly so they are not silently forgotten

## Best Practices
- Before starting any task, check whether relevant state files exist and read them first
- Update state files immediately after a significant change, not in a deferred batch
- When state files conflict with the current code/system, trust the current system and correct the state file

## Internal Checklist (before starting work)
- Have I read the available project documentation before starting?
- Am I about to claim to remember something I cannot actually verify is available?
- Does a state file need updating after this change?

## Validation Checklist (before declaring done)
- Context claims are traceable to an actual file or a verified system check, not assumed memory

## Quality Rules
- No claim of "remembering" a conversation that is not actually available in context

## Security Rules
- State files must never store secrets/credentials in plaintext

## Performance Rules
- N/A

## Common Mistakes to Avoid
- Fabricating plausible-sounding prior context instead of admitting it is unavailable and rebuilding from files
- Letting state files go stale relative to the actual current system

## Success Criteria
- Project context is always rebuildable from durable files, and stated facts are always traceable to a real source

## Interaction with Other Skills
- **documentation-specialist** — Coordinates on where/how state is documented.
- **system-auditor** — Feeds audit findings into tracked known-issues/technical-debt state.
- **technical-lead** — Supplies current project state to ground task coordination in reality.

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
