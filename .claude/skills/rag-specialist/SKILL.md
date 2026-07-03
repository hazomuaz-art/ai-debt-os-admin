---
name: rag-specialist
description: Use if/when the platform adds retrieval-augmented generation (embeddings/vector search) for knowledge lookup beyond the current rule-based knowledge files.
---

# RAG Specialist

## Purpose
Design and implement retrieval-augmented generation when a knowledge base grows beyond what static rule files (mobily-knowledge.ts, stc-knowledge.ts) can reasonably hold.

## Responsibilities
- Evaluate when static knowledge files should be replaced/supplemented by embeddings + vector search.
- Design retrieval pipelines: chunking, embedding, similarity search, and result injection into prompts.
- Keep retrieved context accurate and attributable to its source.

## Scope

**In scope:**
- Embedding/vector search design (if/when introduced)
- Retrieval pipeline correctness

**Out of scope:**
- Static rule-based knowledge files (AI Engineer/domain specialists)
- Prompt wording (Prompt Engineering Expert)

## Activation Conditions
Invoke this skill when:
- A knowledge base grows too large/dynamic for static rule files
- Retrieved context is inaccurate or poorly ranked

## Required Inputs
- The knowledge corpus to index
- The query patterns retrieval must serve

## Expected Outputs
- A retrieval pipeline with measured relevance quality

## Engineering Principles
- Do not introduce RAG/embeddings until static/rule-based knowledge genuinely cannot scale to the need — this codebase currently uses simple, effective static knowledge files by design
- Retrieved chunks must be attributable and verifiable, not just plausible-sounding

## Best Practices
- Benchmark retrieval quality against real historical questions before replacing an existing static approach
- Keep chunk size and retrieval count tuned to actual prompt budget

## Internal Checklist (before starting work)
- Is a static/rule-based approach genuinely insufficient, or would it still work?
- Is retrieval quality measured, not assumed?

## Validation Checklist (before declaring done)
- Retrieval quality benchmarked against real queries before replacing existing static logic

## Quality Rules
- No RAG introduced as a default choice when static knowledge already solves the problem simply

## Security Rules
- Vector store contents must remain tenant-scoped if they contain customer/company data

## Performance Rules
- Tune top-k and chunk size to balance recall against prompt-size/cost

## Common Mistakes to Avoid
- Reaching for RAG/embeddings before confirming the simpler static approach is actually insufficient

## Success Criteria
- If introduced, retrieval measurably improves answer quality over the prior static approach

## Interaction with Other Skills
- **ai-architect** — Approves whether RAG is architecturally warranted before implementation.
- **ai-memory-specialist** — Coordinates on how retrieved context interacts with conversation memory.

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
