-- Seeds the Mobily portfolio's company_playbooks policy row: Saudi
-- professional tone only, no payment-pressure-every-reply, answer questions
-- first, explain the debt when asked, no agent-granted discounts,
-- installments allowed only as an admin-approved request (the agent records
-- and forwards, never approves). Operational/service-status knowledge and
-- the status-based payment-number routing (Inactive→service number,
-- Closed→account number) are enforced in code (src/lib/mobily-knowledge.ts),
-- mirroring the STC pattern; this row carries the written policy + FAQ
-- guidance the agent reads before replying.
--
-- forbidden_phrases and escalation_rules are intentionally empty for Mobily
-- (no legal-path suppression like STC, no custom keyword escalations).
--
-- The Mobily portfolio's real DB name is "موبايلي" — looked up by
-- company_import_profiles alias 'mobily' below so this migration never
-- silently no-ops if the portfolio row is recreated under a different id.

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
  '{"allowed": true, "max_months": 12, "requires_admin_approval": true}',
  '["account_number","product_number","sadad_number","service_status","invoice_dispute","statement_request"]',
  '["wrong_number","not_mine","wrong_amount","already_settled","invoice_dispute","statement_request"]',
  'سياسة موبايلي: تحصيل مهني هادئ باللهجة السعودية فقط، إجابة أسئلة العميل أولاً، شرح المديونية عند السؤال، بلا خصم من الوكيل والتقسيط برفع طلب للإدارة فقط.',
$pol$الرد باللهجة السعودية المهنية فقط، وممنوع أي لهجة غير سعودية.
ممنوع الأسلوب غير المهذب أو الاستفزازي أو التهديد غير المهني.
ممنوع تكرار سؤال السداد في كل رد، وممنوع تحويل أي رد إلى "متى تسدد؟" بدون سبب.
إذا سأل العميل سؤالاً يُجاب على سؤاله أولاً.
إذا أرسل تحية فقط يُرد بتحية قصيرة مهنية، وممنوع البدء بالمديونية مباشرة بعد التحية.
يجب قراءة كامل بيانات العميل وسجل المحادثة وسياسة المحفظة قبل الرد.
ممنوع اختراع معلومات غير موجودة في بيانات العميل؛ وإذا كانت المعلومة غير متوفرة يوضّح ذلك للعميل.
لا تُمنح خصومات للعميل ولا يعتمد الوكيل أي خصم أو تخفيض؛ وإذا طلب العميل خصماً يُسجّل الطلب ويُحوّل للمراجعة.
التقسيط مسموح حسب سياسة موبايلي لكن لا يمنحه الوكيل من عنده؛ يُسجّل طلب التقسيط ويُحوّل للمسار المعتمد.
يجب شرح تفاصيل المديونية عند سؤال العميل عنها.
إذا أنكر العميل ملكية الرقم أو الحساب يُسجّل الاعتراض ويُوجّه العميل لمراجعة موبايلي للتحقق من الملكية.
ممنوع الادعاء بأن السداد تم التحقق منه قبل المطابقة الفعلية.$pol$,
$ai$معرفة تشغيلية لموبايلي:
- حالة الخدمة Closed تعني فصل كلي، وInactive تعني فصل مؤقت.
- عند سؤال العميل عن طريقة/رقم السداد: اقرأ حالة الخدمة أولاً. Inactive → أعطه رقم الخدمة (Service Number). Closed → أعطه رقم الحساب (Account Number). ممنوع إعطاء الرقم الخطأ، فقد يسجّل السداد على حساب خاطئ. الرقم الصحيح محدّد لك في قسم "معرفة تشغيلية خاصة بموبايلي" في ملف القضية.
أسئلة شائعة:
- إذا قال "حوّلت الرقم لشركة ثانية": وضّح أن انتقال الرقم لمشغّل آخر لا يلغي المديونية تلقائياً، فقد توجد مبالغ غير مفوترة أو شرط جزائي أو مستحقات سابقة.
- إذا سأل عن الشرط الجزائي: وضّح أن قيمته تعتمد على العقد والفترة المتبقية منه.
- إذا طلب نسخة من العقد: وجّهه لموبايلي لرفع طلب الاطلاع على العقد.
- إذا سأل عن استرجاع الرقم بعد السداد: وجّهه لخدمة عملاء موبايلي للتحقق من إمكانية استرجاع الرقم.$ai$,
  array[]::text[],
  '[]',
  null
from portfolios p
where p.name in ('موبايلي', 'موبايلى', 'Mobily', 'mobily')
  and not exists (
    select 1 from company_playbooks cp where cp.portfolio_id = p.id
  );
