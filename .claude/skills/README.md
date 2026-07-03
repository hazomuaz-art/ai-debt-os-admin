# AI Debt OS Admin — Enterprise Engineering Skills Framework

61 Claude Code skills modeling a complete enterprise engineering organization for
this repository. Each skill lives at `<skill-id>/SKILL.md` with the same 16
required sections (Purpose, Responsibilities, Scope, Activation Conditions,
Required Inputs, Expected Outputs, Engineering Principles, Best Practices,
Internal Checklist, Validation Checklist, Quality Rules, Security Rules,
Performance Rules, Common Mistakes, Success Criteria, Interaction with Other
Skills) plus a shared **Global Engineering Rules** block and **Project Context**
footer, so every skill is self-contained and consistent.

57 skills were explicitly requested. 4 were added during self-review because the
requested list had no owner for them despite them being real, active concerns in
this specific codebase (see "Self-Review Additions" below).

## How skills hand off to each other

The framework is organized as five layers. Work generally flows top to bottom:
strategy decides *whether/where*, engineering decides *how*, and the operational
layers verify, ship, and keep it running.

```
Strategy/Leadership   -> decides scope and placement
        |
Engineering (by area) -> designs and implements
        |
Quality/Security      -> verifies correctness and safety
        |
Infrastructure/Ops    -> ships and keeps it running
        |
Cross-cutting         -> memory, audits, and domain knowledge feed every layer
```

## Skill Index

### Leadership & Architecture (7)
| Skill | Purpose |
|---|---|
| [enterprise-architect](enterprise-architect/SKILL.md) | System-wide module boundaries and structural decisions |
| [principal-engineer](principal-engineer/SKILL.md) | Detailed technical design once architecture is set |
| [distinguished-software-engineer](distinguished-software-engineer/SKILL.md) | The hardest, most recurring bug classes and precedent-setting fixes |
| [chief-technology-officer](chief-technology-officer/SKILL.md) | Technology investment and risk tradeoffs |
| [technical-lead](technical-lead/SKILL.md) | Day-to-day sequencing across specialist skills |
| [senior-full-stack-engineer](senior-full-stack-engineer/SKILL.md) | End-to-end feature slices (UI + API + data) |
| [enterprise-product-manager](enterprise-product-manager/SKILL.md) | Turns business asks into scoped requirements |

### Engineering — Backend & Data (7)
| Skill | Purpose |
|---|---|
| [senior-backend-engineer](senior-backend-engineer/SKILL.md) | API routes, Server Actions, cron logic |
| [nodejs-expert](nodejs-expert/SKILL.md) | Node runtime, scripts, async correctness |
| [rest-api-expert](rest-api-expert/SKILL.md) | API/webhook contracts and error shapes |
| [database-architect](database-architect/SKILL.md) | Schema design, migrations, RLS design |
| [postgresql-expert](postgresql-expert/SKILL.md) | Raw SQL/PLpgSQL, function hardening |
| [supabase-expert](supabase-expert/SKILL.md) | RLS policy correctness, client selection, Storage/Auth |
| [query-optimization-expert](query-optimization-expert/SKILL.md) | Query-level performance and indexing |

### Engineering — Frontend (4)
| Skill | Purpose |
|---|---|
| [senior-frontend-engineer](senior-frontend-engineer/SKILL.md) | Dashboard pages/components, RTL layout |
| [nextjs-expert](nextjs-expert/SKILL.md) | App Router routing/rendering/caching |
| [react-expert](react-expert/SKILL.md) | Hooks, state, re-render correctness |
| [typescript-expert](typescript-expert/SKILL.md) | Shared types, generics, type accuracy |

### AI & Automation (8)
| Skill | Purpose |
|---|---|
| [ai-architect](ai-architect/SKILL.md) | Deterministic-vs-LLM boundary, AI data contracts |
| [ai-engineer](ai-engineer/SKILL.md) | AI integration implementation and fallbacks |
| [llm-engineer](llm-engineer/SKILL.md) | Model selection, structured-output parsing, cost |
| [prompt-engineering-expert](prompt-engineering-expert/SKILL.md) | System prompt design and iteration |
| [ai-memory-specialist](ai-memory-specialist/SKILL.md) | Conversation memory, case-note, context scoping |
| [rag-specialist](rag-specialist/SKILL.md) | Retrieval-augmented generation (if/when needed) |
| [ai-agents-specialist](ai-agents-specialist/SKILL.md) | End-to-end WhatsApp collector agent behavior |
| [automation-engineer](automation-engineer/SKILL.md) | Automation pipeline steps and reconciliation crons |

### Security (6)
| Skill | Purpose |
|---|---|
| [cybersecurity-architect](cybersecurity-architect/SKILL.md) | Tenant isolation architecture, privilege boundaries |
| [secure-coding-expert](secure-coding-expert/SKILL.md) | Line-level injection/XSS/auth-bypass review |
| [owasp-specialist](owasp-specialist/SKILL.md) | Structured OWASP Top 10 review |
| [devsecops-engineer](devsecops-engineer/SKILL.md) | Deploy-time automated security/quality gates |
| [penetration-tester](penetration-tester/SKILL.md) | Adversarial verification of security boundaries |
| [enterprise-compliance-specialist](enterprise-compliance-specialist/SKILL.md) | Data protection, retention, audit trails |

### Infrastructure & Operations (9)
| Skill | Purpose |
|---|---|
| [devops-engineer](devops-engineer/SKILL.md) | deploy.ps1 pipeline, crontab management |
| [cloud-infrastructure-engineer](cloud-infrastructure-engineer/SKILL.md) | Scaling and disaster-recovery planning |
| [hostinger-vps-specialist](hostinger-vps-specialist/SKILL.md) | Production VPS-specific configuration |
| [ubuntu-linux-specialist](ubuntu-linux-specialist/SKILL.md) | OS-level config, cron, permissions |
| [nginx-specialist](nginx-specialist/SKILL.md) | Reverse proxy, SSL, routing |
| [pm2-specialist](pm2-specialist/SKILL.md) | Process management and stability verification |
| [monitoring-specialist](monitoring-specialist/SKILL.md) | Health checks, logging quality, alerting |
| [performance-engineer](performance-engineer/SKILL.md) | Application-level performance diagnosis |
| [scalability-engineer](scalability-engineer/SKILL.md) | Growth-driven scaling assessment |

### Reliability & Quality (7)
| Skill | Purpose |
|---|---|
| [site-reliability-engineer](site-reliability-engineer/SKILL.md) | Reliability targets and incident postmortems |
| [qa-engineer](qa-engineer/SKILL.md) | Unit tests, golden-path + edge-case verification |
| [e2e-testing-expert](e2e-testing-expert/SKILL.md) | Full user-journey testing on the running app |
| [regression-prevention-specialist](regression-prevention-specialist/SKILL.md) | Codebase-wide sweeps after every bug fix |
| [root-cause-analysis-specialist](root-cause-analysis-specialist/SKILL.md) | Tracing bugs to their true origin |
| [code-review-specialist](code-review-specialist/SKILL.md) | Line-by-line diff review before shipping |
| [incident-response-engineer](incident-response-engineer/SKILL.md) | Active-incident triage and stabilization |

### Release & Readiness (2)
| Skill | Purpose |
|---|---|
| [production-readiness-specialist](production-readiness-specialist/SKILL.md) | Final go/no-go checklist before shipping |
| [release-manager](release-manager/SKILL.md) | Deploy sequencing and post-deploy verification |

### Integrations (2)
| Skill | Purpose |
|---|---|
| [integration-engineer](integration-engineer/SKILL.md) | Email/n8n/RASF and other third-party integrations |
| [whatsapp-integration-expert](whatsapp-integration-expert/SKILL.md) | WAHA gateway, session health, inbound/outbound |

### Domain & Business (2)
| Skill | Purpose |
|---|---|
| [business-analyst](business-analyst/SKILL.md) | Real business-process-to-system gap analysis |
| [saudi-debt-collection-expert](saudi-debt-collection-expert/SKILL.md) | Saudi market and provider-specific collection policy |

### Documentation (1)
| Skill | Purpose |
|---|---|
| [documentation-specialist](documentation-specialist/SKILL.md) | Durable docs and rationale, never restating code |

### Cross-Cutting Memory & Audit (2 — special requirements)
| Skill | Purpose |
|---|---|
| [project-memory](project-memory/SKILL.md) | Rebuilds context from project files; never fabricates memory of unavailable chats |
| [system-auditor](system-auditor/SKILL.md) | Full-system findings reports, evidence-based, honest about coverage limits |

### Self-Review Additions (4)
Identified as real gaps while reviewing the framework against this specific
codebase — none of the 57 requested roles explicitly owned these, and all four
map to concerns that have already caused real bugs or real risk in this project:

| Skill | Why it was added |
|---|---|
| [arabic-localization-specialist](arabic-localization-specialist/SKILL.md) | This is an Arabic-first, RTL product — no requested skill owned linguistic/RTL correctness specifically |
| [git-workflow-specialist](git-workflow-specialist/SKILL.md) | This repo has documented, recurring git quirks (Defender lock, working-tree-not-HEAD deploy model, Windows-vs-Linux hash comparison) that need a dedicated owner |
| [cost-finops-specialist](cost-finops-specialist/SKILL.md) | Real OpenAI API spend and per-tenant cost attribution exist in this codebase (cost-tracker.ts, ai-revenue-attribution.ts) with no requested owner |
| [data-import-specialist](data-import-specialist/SKILL.md) | Bulk import (debts, employees) is a core, complex, error-prone feature area with no requested owner beyond generic backend work |

## Global Engineering Rules

Every skill in this framework embeds the same non-negotiable rules (root-cause
only, no placeholders, no silent errors, always verify, Supabase writes must
check `error`, sweep for repeated bug patterns, etc.) in its own
**Global Engineering Rules** section. They are not a separate file to avoid
skills silently drifting out of sync with a shared include — each skill is
fully self-contained.

## Usage

Invoke a skill directly with `/`+its id (e.g. `/system-auditor`,
`/database-architect`), or let it activate implicitly when a task matches its
**Activation Conditions**. `project-memory` and `system-auditor` are the two
skills most other work should start from: `project-memory` to rebuild context,
`system-auditor` to get an honest current-state baseline before deciding what
to change.
