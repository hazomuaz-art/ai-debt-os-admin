-- ============================================================
-- MIGRATION 022: Portfolio-specific customer data tables
--
-- كل محفظة (Mobily, STC, التعاونية...) لديها أعمدة مختلفة تمامًا
-- عند الاستيراد من النظام المصدر. بدل تضخيم جدول customers بأعمدة
-- نادرة الاستخدام، ننشئ جدول تفصيلي مستقل لكل محفظة، مرتبط بـ
-- customers(id) و portfolios(id).
--
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. MOBILY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_mobily (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id    UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number  TEXT,         -- رقم الحساب
  product_number  TEXT,         -- رقم المنتج
  product_type    TEXT,         -- نوع المنتج
  category        TEXT,         -- CATEGORY
  status_date     DATE,         -- STATUS_DATE
  mnp             TEXT,         -- MNP
  id_type         TEXT,         -- نوع الهوية
  created_date    DATE,         -- CREATED_DATE
  discount        DECIMAL(15,2),-- DISCOUNT
  city            TEXT,         -- CITY
  service_status  TEXT,         -- SERVICE_STATUS
  email           TEXT,         -- EMAIL
  nationality     TEXT,         -- NATIONALITY
  sadad_number    TEXT,         -- SADAD_NUMBER
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. STC
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_stc (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id               UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id              UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id             UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number           TEXT,        -- رقم الحساب
  product_number           TEXT,        -- رقم المنتج
  working_services_flag    TEXT,        -- WORKING_SERVICES_FLAG
  account_status_date      DATE,        -- ACCOUNT_STATUS_DATE
  customer_established_dt  DATE,        -- CUSTOMER_ESTABLISHED_DT
  id_type                  TEXT,        -- نوع الهوية
  baqa_flag                TEXT,        -- BAQA_FLAG
  sadad_number             TEXT,        -- Sadad_NUMBER
  metadata                 JSONB DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. الطاقة السعودية (Saudi Energy)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_saudi_energy (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id                   UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id                  UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number                TEXT,         -- رقم الحساب
  product_number                TEXT,         -- رقم المنتج
  account_type                  TEXT,         -- نوع الحساب
  last_invoice_date             DATE,         -- Last Invoice Date
  move_out_date                 DATE,         -- Move-Out Date
  last_invoice_amount           DECIMAL(15,2),-- Last Invoice Amount
  open_bills_count              INTEGER,      -- No of open Bills
  department                    TEXT,         -- Department_5
  last_payment_date             DATE,         -- Last Payment Date
  mc_cc_indicator                TEXT,         -- MC/CC Indicator
  email                          TEXT,         -- E-Mail Address
  installation_blocking_reason  TEXT,         -- Installation Blocking Reason_3
  crn_owner_id                  TEXT,         -- CRN Owner ID
  account_status                TEXT,         -- Account Status
  mc_cc                         TEXT,         -- MC/CC
  metadata                      JSONB DEFAULT '{}',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. علم - تم (Elm - Tam)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_elm (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id        UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number      TEXT,         -- رقم الحساب
  account_type        TEXT,         -- نوع الحساب
  year                INTEGER,      -- YEAR
  quarterly           TEXT,         -- Quarterly
  transactions_count  INTEGER,      -- No Of Transactions
  end_date            DATE,         -- End Date
  location             TEXT,         -- الموقع
  owner_national_id   TEXT,         -- رقم هوية المالك
  owner_name          TEXT,         -- اسم المالك
  primary_user_name   TEXT,         -- اسم المستخدم الرئيسي
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. المياه الوطنية (National Water)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_national_water (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id        UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number      TEXT,         -- رقم الحساب
  drainage_agreement  TEXT,         -- اتفاقية الصرف
  coordinates         TEXT,         -- الإحداثية
  region              TEXT,         -- المنطقة
  last_invoice_date   DATE,         -- آخر تاريخ فاتورة
  customer_category   TEXT,         -- تصنيف العميل
  water_agreement     TEXT,         -- اتفاقية الماء
  last_payment_date   DATE,         -- آخر تاريخ دفع
  city                TEXT,         -- المدينة
  last_payment_amount DECIMAL(15,2),-- آخر دفع
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. التعاونية (حق رجوع + طرف ثالث) — Tawuniya
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_tawuniya (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id        UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number      TEXT,         -- رقم الحساب
  product_number      TEXT,         -- رقم المنتج
  product_type        TEXT,         -- نوع المنتج
  owner_mobile        TEXT,         -- رقم جوال المالك
  recovery_number     TEXT,         -- رقم الاسترداد
  accident_city       TEXT,         -- مدينة الحادث
  accident_date        DATE,         -- تاريخ الحادث
  owner_name          TEXT,         -- اسم المالك
  vehicle_type        TEXT,         -- نوع السيارة
  fault_percentage    DECIMAL(5,2), -- نسبه الخطا
  plate_number        TEXT,         -- لوحة السيارة
  owner_national_id   TEXT,         -- رقم هوية المالك
  traffic_dept        TEXT,         -- المرور
  recourse_reason     TEXT,         -- سبب حق الرجوع
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. ميدغلف (Medgulf)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_medgulf (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id        UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number      TEXT,         -- رقم الحساب
  product_number      TEXT,         -- رقم المنتج
  product_type        TEXT,         -- نوع المنتج
  accident_city       TEXT,         -- مدينة الحادث
  vehicle_type        TEXT,         -- نوع السيارة
  owner_mobile        TEXT,         -- رقم جوال المالك
  owner_name          TEXT,         -- اسم المالك
  traffic_dept        TEXT,         -- المرور
  fault_percentage    DECIMAL(5,2), -- نسبه الخطا
  accident_number     TEXT,         -- رقم الحادث
  recourse_reason     TEXT,         -- سبب حق الرجوع
  plate_number        TEXT,         -- لوحة السيارة
  accident_date       DATE,         -- تاريخ الحادث
  owner_national_id   TEXT,         -- رقم هوية المالك
  da                  TEXT,         -- DA
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. مهارة للاستقدام (Mahara Recruitment)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_mahara (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id             UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id            UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id           UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number         TEXT,         -- رقم الحساب
  branch                 TEXT,         -- الفرع
  last_paid_amount       DECIMAL(15,2),-- اخر مبلغ تم سداده
  worker_nationality     TEXT,         -- جنسية العامل
  nationality            TEXT,         -- الجنسية
  legal_notes            TEXT,         -- ملاحظات القانونية
  employer               TEXT,         -- جهة العمل
  workers_count          INTEGER,      -- عدد العماله
  worker_name            TEXT,         -- اسم العامل
  worker_gender          TEXT,         -- جنس العمل
  city                   TEXT,         -- المدينة
  contract_end_date      DATE,         -- تاريخ انتهاء التعاقد
  contract_status        TEXT,         -- حالة العقد
  worker_status          TEXT,         -- حالة العامل
  recommendation         TEXT,         -- التوصية
  last_payment_date      DATE,         -- تاريخ اخر سداد
  address                TEXT,         -- العنوان
  contract_start_date    DATE,         -- تاريخ بداية التعاقد
  request_date_hijri     TEXT,         -- تاريخ الطلب هجري
  decisions              TEXT,         -- القرارت
  emails                 TEXT,         -- الأيميلات
  metadata               JSONB DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. WAFRH
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_wafrh (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id    UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number  TEXT,         -- رقم الحساب
  agent_name      TEXT,         -- المندوب
  city            TEXT,         -- المدينة
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. التنمية الزراعية (Agricultural Development)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_agri_dev (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id         UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number       TEXT,         -- رقم الحساب
  account_type         TEXT,         -- نوع الحساب
  legal_action_taken   BOOLEAN DEFAULT false, -- تم اتخاذ إجراء قانوني
  debt_date            DATE,         -- تاريخ المديونية
  city                 TEXT,         -- المدينة
  email                TEXT,         -- EMAIL
  metadata             JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. العربية للأسماك (Arabian Fisheries)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_fisheries (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id         UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number       TEXT,         -- رقم الحساب
  account_type         TEXT,         -- نوع الحساب
  debt_date            DATE,         -- تاريخ المديونية
  legal_action_taken   BOOLEAN DEFAULT false, -- تم اتخاذ إجراء قانوني
  agent_name           TEXT,         -- المندوب
  city                 TEXT,         -- المدينة
  metadata             JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. كناهل الزراعية (Kanahel Agricultural)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_data_kanahel (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  portfolio_id         UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  account_number       TEXT,         -- رقم الحساب
  customer_status      TEXT,         -- حالة العميل
  proof_of_dues        TEXT,         -- PROOF OF DUES
  reasons_of_dues      TEXT,         -- REASONS OF THE DUES
  customer_city        TEXT,         -- CUSTOMER CITY
  metadata             JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES — كل جدول يحتاج بحث سريع حسب customer_id و company_id
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cd_mobily_customer       ON public.customer_data_mobily(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_mobily_company         ON public.customer_data_mobily(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_stc_customer           ON public.customer_data_stc(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_stc_company            ON public.customer_data_stc(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_senergy_customer       ON public.customer_data_saudi_energy(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_senergy_company        ON public.customer_data_saudi_energy(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_elm_customer           ON public.customer_data_elm(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_elm_company            ON public.customer_data_elm(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_water_customer         ON public.customer_data_national_water(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_water_company          ON public.customer_data_national_water(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_tawuniya_customer      ON public.customer_data_tawuniya(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_tawuniya_company       ON public.customer_data_tawuniya(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_medgulf_customer       ON public.customer_data_medgulf(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_medgulf_company        ON public.customer_data_medgulf(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_mahara_customer        ON public.customer_data_mahara(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_mahara_company         ON public.customer_data_mahara(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_wafrh_customer         ON public.customer_data_wafrh(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_wafrh_company          ON public.customer_data_wafrh(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_agri_customer          ON public.customer_data_agri_dev(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_agri_company           ON public.customer_data_agri_dev(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_fisheries_customer     ON public.customer_data_fisheries(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_fisheries_company      ON public.customer_data_fisheries(company_id);
CREATE INDEX IF NOT EXISTS idx_cd_kanahel_customer       ON public.customer_data_kanahel(customer_id);
CREATE INDEX IF NOT EXISTS idx_cd_kanahel_company        ON public.customer_data_kanahel(company_id);

-- ============================================================
-- RLS — نفس نموذج الوصول متعدد المستأجرين المستخدم في باقي الجداول
-- ============================================================
ALTER TABLE public.customer_data_mobily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_stc            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_saudi_energy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_elm            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_national_water ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_tawuniya       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_medgulf        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_mahara         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_wafrh          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_agri_dev       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_fisheries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_data_kanahel        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_data_mobily','customer_data_stc','customer_data_saudi_energy',
    'customer_data_elm','customer_data_national_water','customer_data_tawuniya',
    'customer_data_medgulf','customer_data_mahara','customer_data_wafrh',
    'customer_data_agri_dev','customer_data_fisheries','customer_data_kanahel'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (
         company_id = public.get_user_company_id()
       ) WITH CHECK (
         company_id = public.get_user_company_id()
       )', t || '_company_isolation', t
    );
  END LOOP;
END $$;

COMMIT;
