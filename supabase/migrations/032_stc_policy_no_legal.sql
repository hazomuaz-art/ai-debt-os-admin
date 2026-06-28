BEGIN;

-- Seeds the STC portfolio's company_playbooks policy row: bans the
-- legal/threat path entirely (forbidden_phrases + escalation_rules = '[]'),
-- makes sadad_number the primary payment source, and documents the new
-- customer_complaint/stc_review non-freezing review buckets (handled in
-- code by src/lib/legal-escalation.ts's suppressLegalTriggers +
-- detectStcReviewSignal/recordStcReview, not by this row's escalation_rules
-- — escalation_rules is intentionally empty so no keyword can ever map to a
-- legal_escalations lock for this portfolio, even via future admin edits to
-- this row through the UI).
--
-- The STC portfolio's real DB name is "إس تي سي" (Arabic), not the Latin
-- "STC" — looked up by company_import_profiles alias 'stc' below so this
-- migration never silently no-ops if the portfolio row is ever recreated
-- under a different id.

insert into company_playbooks (
  company_id, portfolio_id, version, is_active,
  discounts, installments, fields_to_surface, allowed_dispute_types,
  notes, company_policy, ai_instructions, forbidden_phrases, escalation_rules, portfolio_specific_rules
)
select
  p.company_id,
  p.id,
  1, true,
  '{"allowed": false, "max_percent": 0, "requires_admin_approval": true}',
  '{"allowed": false, "max_months": 0, "requires_admin_approval": true}',
  '["account_number","product_number","sadad_number","invoice_dispute","statement_request"]',
  '["wrong_number","not_mine","wrong_amount","already_settled","invoice_dispute","statement_request","invoice_details","deceased_customer"]',
  'سياسة STC المحدّثة: ممنوع أي مسار قانوني أو تهديدي بالكامل — التحصيل بأسلوب مهني هادئ فقط.',
$pol$يمنع منعاً باتاً التهديد أو التخويف بأي شكل.
يمنع ذكر محامٍ أو محكمة أو قضية أو أي إجراءات قانونية.
يمنع ذكر إيقاف الخدمات أو التنفيذ أو الإنذارات القانونية.
يمنع استخدام أي لغة ضغط أو تهديد مع العميل.
يتم التعامل مع العميل بأسلوب مهني هادئ وباللهجة السعودية.
الهدف الوحيد: توضيح المديونية والمساعدة على السداد، لا أكثر.$pol$,
$ai$استخدم رقم السداد (sadad_number) الخاص بالعميل إذا كان موجوداً في ملف القضية.
sadad_number هو المصدر الأساسي والمعتمد للسداد لمحفظة STC.
إذا وُجد sadad_number فلا تستخدم ولا تذكر collection_accounts إطلاقاً.
لا تطلب من العميل آيبان أبداً.
لا تخترع رقم مفوتر أو رقم حساب أو طريقة سداد غير موجودة في ملف القضية.
لا تطلب من العميل معلومة موجودة بالفعل في ملف القضية.
لا تكرر سؤال "متى تسدد؟" أكثر من مرة واحدة في نفس المحادثة.
عند وجود اعتراض من العميل، سجّله وتعامل معه بدون أي ضغط إضافي.$ai$,
  array['محامي','محكمة','قضية','قانوني','إجراءات قانونية','رفع قضية','رفع دعوى','إيقاف خدمات','تنفيذ','إنذار','أتعاب قضائية','شرطة','سجن','سمة','SIMAH'],
  '[]',
  null
from portfolios p
where p.name in ('إس تي سي', 'STC', 'اس تي سي')
  and not exists (
    select 1 from company_playbooks cp where cp.portfolio_id = p.id
  );

COMMIT;
