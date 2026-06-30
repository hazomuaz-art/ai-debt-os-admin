-- Real bug found in full-system audit: 'repeated_refusal' was added to the
-- TypeScript EscalationType union (src/lib/legal-escalation.ts) for the
-- owner-specified "3+ refusals -> lawyer persona" business rule, but the
-- legal_escalations.escalation_type CHECK constraint in the database was
-- never updated to match. Every attempt by the legal-escalation-check cron
-- to open this escalation type has failed (caught and logged, but the
-- feature has never actually worked since it was specified).
BEGIN;

ALTER TABLE public.legal_escalations DROP CONSTRAINT IF EXISTS legal_escalations_escalation_type_check;
ALTER TABLE public.legal_escalations ADD CONSTRAINT legal_escalations_escalation_type_check
  CHECK (escalation_type = ANY (ARRAY[
    'legal_threat', 'lawyer_mention', 'complaint', 'fault_dispute', 'recourse_dispute',
    'third_party_dispute', 'recovered_deduction', 'playbook_mandated', 'repeated_refusal'
  ]::text[]));

COMMIT;
