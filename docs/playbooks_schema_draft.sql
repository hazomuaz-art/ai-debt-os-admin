-- ============================================================================
-- DRAFT — Company Playbooks (سياسات المشاريع) schema
-- NOT applied yet. Review only. Apply later via apply_migration when approved.
-- ============================================================================

-- 1) سياسات المشاريع — سياسة مستقلة لكل شركة/جهة دائنة
create table if not exists playbooks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,                       -- المستأجر (الشركة المالكة للنظام)
  name            text not null,                       -- اسم الشركة/المشروع (مثل: التأمين التعاوني)
  project_type    text not null default 'other',       -- insurance | telecom | utility | government | other
  description     text,                                -- وصف العمل
  creditor_name   text,                                -- الجهة الدائنة (للربط مع debts.creditor_name)
  portfolio_id    uuid,                                -- ربط اختياري بالمحفظة

  -- محتوى السياسة (يُحقن في تعليمات الوكيل)
  key_fields        jsonb default '[]'::jsonb,          -- الحقول المهمة لهذا المشروع
  claim_types       jsonb default '[]'::jsonb,          -- أنواع المطالبات وطريقة تصنيفها
  tone              text,                                -- نبرة الرد المطلوبة
  forbidden_words   text[] default '{}',                 -- الكلمات الممنوعة
  reply_templates   jsonb default '[]'::jsonb,          -- قوالب الرد لكل حالة
  escalation_rules  jsonb default '[]'::jsonb,          -- قواعد التصعيد لموظف
  rules             jsonb default '{}'::jsonb,          -- متى يرد/لا يرد/يفتح اعتراض/يطلب إثبات
  operational_steps jsonb default '[]'::jsonb,          -- الخطوات التشغيلية
  prompt_extra      text,                                -- نص حر يُضاف لتعليمات الوكيل

  is_active   boolean not null default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_playbooks_company   on playbooks(company_id, is_active);
create index if not exists idx_playbooks_creditor  on playbooks(company_id, creditor_name);
create index if not exists idx_playbooks_portfolio on playbooks(portfolio_id);

-- 2) تفاصيل المطالبة — مرتبطة بكل دين (خاصة لمشاريع التأمين وما شابه)
create table if not exists claim_details (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  debt_id       uuid not null,                          -- FK -> debts (نضيف القيد عند التطبيق)
  playbook_id   uuid,                                    -- السياسة المطبّقة

  claim_type        text,            -- recourse(حق رجوع) | third_party(طرف ثالث) | recovered_deletion(حذف مسترد) | unclear(غير واضح)
  claim_reason      text,            -- no_license | expired_license | fleeing | drifting | dui | unauthorized_use | policy_violation | other
  najm_ref          text,            -- رقم نجم
  accident_ref      text,            -- رقم الحادث
  accident_date     date,            -- تاريخ الحادث
  fault_percentage  numeric,         -- نسبة الخطأ
  has_valid_insurance boolean,       -- وجود تأمين ساري وقت الحادث
  policy_number     text,            -- رقم وثيقة التأمين
  claim_number      text,            -- رقم المطالبة

  review_status     text default 'none',   -- none | pending_review | confirmed | dropped | recovered
  supporting_docs   jsonb default '[]'::jsonb,   -- مستندات العميل (روابط/أوصاف)
  statements        jsonb default '[]'::jsonb,   -- الإفادات
  metadata          jsonb default '{}'::jsonb,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_claim_details_debt    on claim_details(debt_id);
create index if not exists idx_claim_details_company on claim_details(company_id);

-- 3) سيناريوهات اختبار السياسات (للتدريب قبل التشغيل)
create table if not exists playbook_tests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  playbook_id     uuid not null,
  scenario_name   text,
  customer_message text,                 -- رسالة العميل المحاكاة
  expected_intent text,                  -- النية المتوقعة
  expected_action text,                  -- الإجراء المتوقع (reply/record_dispute/human_review...)
  expect_escalate boolean default false, -- هل يُفترض التصعيد؟
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists idx_playbook_tests_pb on playbook_tests(playbook_id);
