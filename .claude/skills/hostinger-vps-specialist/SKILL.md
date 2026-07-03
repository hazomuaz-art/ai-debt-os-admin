---
name: hostinger-vps-specialist
description: Use for anything specific to the production Hostinger VPS at 72.62.30.109 — resource limits, VPS-level configuration, and Hostinger-specific quirks.
---

# Hostinger VPS Specialist

## Purpose
Know and manage the specifics of this project's actual production VPS.

## Responsibilities
- Track the VPS's actual resource limits (CPU/RAM/disk) and current utilization.
- Manage VPS-level configuration outside of the app itself (firewall, SSH access, system packages).
- Flag when VPS resource constraints are becoming a real limiting factor.

## Scope

**In scope:**
- Hostinger VPS-specific configuration and resource management

**Out of scope:**
- App-level deploy mechanics (DevOps Engineer)
- Nginx/PM2 configuration specifics (their own specialist skills)

## Activation Conditions
Invoke this skill when:
- A VPS resource limit is suspected of causing an issue
- VPS-level (not app-level) configuration needs to change

## Required Inputs
- Current VPS resource usage (disk, memory, CPU)
- The specific VPS-level change needed

## Expected Outputs
- A verified VPS-level fix or configuration change

## Engineering Principles
- SSH writes to the production VPS are high-blast-radius actions — confirm the exact command before running, and treat unfamiliar VPS state (unknown processes, lock files) as someone else's in-progress work until investigated
- Never assume VPS resource headroom — check df/free/top directly

## Best Practices
- Check disk space before large builds/deploys (npm install + next build can consume significant space)
- Keep SSH access keys and firewall rules minimal and reviewed

## Internal Checklist (before starting work)
- Have I checked actual resource usage rather than assuming headroom?
- Is this VPS-level change reversible, and have I confirmed intent before running it?

## Validation Checklist (before declaring done)
- Resource claims verified with an actual command (df -h, free -m), not assumed

## Quality Rules
- No VPS-level claim made without checking the actual system state

## Security Rules
- SSH access must stay key-based and minimal; no new open ports without a stated reason

## Performance Rules
- Monitor disk/memory headroom proactively before it becomes a deploy-blocking emergency

## Common Mistakes to Avoid
- Assuming disk/memory headroom instead of checking it
- Running a destructive VPS-level command without confirming it first given the high blast radius of production infrastructure

## Success Criteria
- VPS resource state and configuration are known facts, not assumptions, and changes are made deliberately

## Interaction with Other Skills
- **devops-engineer** — Coordinates on how VPS state affects the deploy pipeline.
- **ubuntu-linux-specialist** — Coordinates on OS-level configuration within the VPS.

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
