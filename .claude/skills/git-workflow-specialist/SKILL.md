---
name: git-workflow-specialist
description: Use for git workflow issues specific to this repo's known quirks — Windows Defender lock contention, the working-tree-not-HEAD deploy model, and keeping local/GitHub/VPS in sync.
---

# Git & Version Control Specialist

## Purpose
Keep git history clean and keep local, GitHub, and the deployed VPS state honestly tracked and reconcilable, given this repo's specific known quirks.

## Responsibilities
- Diagnose and work around Windows Defender intermittently locking .git/index on this specific machine.
- Keep commit messages accurate and the history reviewable.
- Verify local/GitHub/VPS sync using content-hash comparison (not git-hash comparison, since the VPS deploy target is not a git repo).

## Scope

**In scope:**
- Git workflow, commit hygiene, cross-environment sync verification

**Out of scope:**
- The deploy mechanics themselves (DevOps Engineer)

## Activation Conditions
Invoke this skill when:
- A git commit fails unexpectedly (possible Defender lock)
- Local/GitHub/VPS sync needs verifying

## Required Inputs
- Current git status and the specific error if a git operation failed

## Expected Outputs
- A clean git state, or a confirmed sync/desync report across environments

## Engineering Principles
- This repo's deploy pipeline ships the working tree, not git HEAD — a failed local commit must never block a deploy, but it should still be understood and retried, not ignored forever
- Since the VPS deploy target is not a git repo, sync verification must use content hashing, not git-hash comparison
- Never force-push or discard uncommitted work without explicit confirmation — investigate unfamiliar git state as possibly in-progress work

## Best Practices
- Retry a failed commit after a short wait if Windows Defender lock is suspected, rather than escalating immediately
- Use a content-hash comparison script (sha256 per file) to verify local vs VPS parity, being mindful that Windows sha256sum output format differs from Linux (binary-mode `*` prefix)

## Internal Checklist (before starting work)
- Is this really a Defender lock, or a real git problem?
- Am I comparing content correctly across Windows and Linux hash output formats?

## Validation Checklist (before declaring done)
- Sync verification uses actual content hashes compared file-by-file, confirmed match/mismatch, not assumed

## Quality Rules
- No destructive git operation (reset --hard, force-push, clean -f) without explicit confirmation

## Security Rules
- Never commit .env files or credentials

## Performance Rules
- N/A

## Common Mistakes to Avoid
- Treating a Windows-vs-Linux sha256sum output format difference as a real content mismatch
- Assuming git-hash comparison works against a VPS target that is not actually a git repository

## Success Criteria
- Local, GitHub, and VPS state are verifiably in sync (or the specific discrepancy is clearly identified), and git history stays clean

## Interaction with Other Skills
- **devops-engineer** — Coordinates on how git state feeds the deploy pipeline.
- **release-manager** — Confirms git/sync state before a release proceeds.

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
