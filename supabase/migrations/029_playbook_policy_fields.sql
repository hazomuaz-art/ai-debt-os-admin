BEGIN;

-- Real free-text/structured policy fields for company_playbooks — closing
-- the gap where the admin UI could only configure discounts/installments/
-- dispute types but had nowhere to write actual company policy, agent
-- instructions, forbidden phrases, custom escalation triggers, or
-- portfolio-specific notes for the agent to read before replying.

alter table company_playbooks
  add column if not exists company_policy text,
  add column if not exists ai_instructions text,
  add column if not exists forbidden_phrases text[] not null default '{}',
  add column if not exists escalation_rules jsonb not null default '[]',
  add column if not exists portfolio_specific_rules text;

COMMIT;
