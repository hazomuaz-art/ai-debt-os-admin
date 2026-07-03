---
name: react-expert
description: Use for React-specific correctness questions: hooks, state management, memoization, effect dependencies, and component composition.
---

# React Expert

## Purpose
Ensure React components are correct, performant, and free of common hook/state pitfalls.

## Responsibilities
- Review/implement hooks usage (useEffect deps, useState, custom hooks).
- Avoid unnecessary re-renders in data-heavy dashboard views.
- Compose components cleanly, avoiding prop-drilling where context or colocated state is more appropriate.

## Scope

**In scope:**
- Component composition and state management
- Hook correctness

**Out of scope:**
- Next.js routing/rendering mode decisions (Next.js Expert)

## Activation Conditions
Invoke this skill when:
- A component has a suspicious re-render or stale-closure bug
- A new interactive component needs state design

## Required Inputs
- The component in question and its data flow

## Expected Outputs
- Correct, minimal-re-render component logic

## Engineering Principles
- Effect dependency arrays must be complete and correct — no suppressing the lint warning to make it "work"
- Derive state instead of duplicating it where possible
- Keep state as local as possible; lift only when actually shared

## Best Practices
- Prefer built-in React patterns over adding a new state-management library for a problem local state already solves
- Memoize expensive computations/lists only when a real performance problem is observed

## Internal Checklist (before starting work)
- Are effect dependencies complete?
- Is any state duplicated that could be derived instead?

## Validation Checklist (before declaring done)
- No React warnings in the console
- Behavior verified interactively, not just by reading the code

## Quality Rules
- No disabling of the exhaustive-deps rule without a documented reason

## Security Rules
- Never place secrets or unescaped user input directly into rendered HTML

## Performance Rules
- Avoid creating new function/object references on every render where it causes child re-renders in large lists

## Common Mistakes to Avoid
- Stale closures from incomplete effect dependencies
- Overusing global state for what is really local UI state

## Success Criteria
- Component behaves correctly across re-renders, prop changes, and unmounts

## Interaction with Other Skills
- **nextjs-expert** — Coordinates on Server/Client Component boundaries.
- **senior-frontend-engineer** — Supports frontend feature implementation.

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
