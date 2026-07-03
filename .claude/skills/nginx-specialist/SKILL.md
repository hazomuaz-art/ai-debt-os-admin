---
name: nginx-specialist
description: Use for reverse-proxy configuration: routing to the Next.js app, SSL/TLS termination, and Nginx-level performance/security settings.
---

# Nginx Specialist

## Purpose
Configure Nginx correctly as the reverse proxy in front of the Next.js app on the VPS.

## Responsibilities
- Maintain Nginx server blocks routing to the PM2-managed Next.js process.
- Manage SSL/TLS certificate configuration.
- Configure security headers, gzip/compression, and reasonable timeout/body-size limits.

## Scope

**In scope:**
- Nginx configuration: routing, SSL, headers, timeouts

**Out of scope:**
- The application behind the proxy (DevOps Engineer/Next.js Expert)

## Activation Conditions
Invoke this skill when:
- A routing, SSL, or Nginx-level performance/security issue is suspected

## Required Inputs
- Current Nginx configuration
- The exact symptom (502s, SSL errors, timeout errors)

## Expected Outputs
- A verified, tested Nginx configuration change

## Engineering Principles
- Test configuration changes (nginx -t) before reloading
- SSL/TLS configuration should use current best-practice ciphers/protocols, not defaults left over from setup

## Best Practices
- Always run nginx -t before reload; a bad config that fails to reload can take the whole site down
- Set body-size limits appropriate for the app's actual needs (e.g. file imports/uploads)

## Internal Checklist (before starting work)
- Has this config been tested with nginx -t before reload?
- Does this change affect SSL/routing for all needed domains/subdomains?

## Validation Checklist (before declaring done)
- nginx -t passes
- Site verified reachable over HTTPS after reload, not just assumed

## Quality Rules
- No config reload without a prior nginx -t pass

## Security Rules
- Only modern, secure TLS protocols/ciphers enabled; weak protocols disabled
- Security headers (HSTS, X-Frame-Options, etc.) present where appropriate

## Performance Rules
- Enable gzip/compression for text assets
- Set sane proxy timeouts matching the app's real response-time profile

## Common Mistakes to Avoid
- Reloading Nginx without testing the config first, causing an outage
- Leaving default/weak SSL settings unreviewed

## Success Criteria
- Nginx correctly and securely proxies all traffic with zero downtime from the config change

## Interaction with Other Skills
- **devops-engineer** — Coordinates on how Nginx fits the overall deploy/restart flow.
- **hostinger-vps-specialist** — Coordinates on VPS-level access needed for Nginx changes.

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
