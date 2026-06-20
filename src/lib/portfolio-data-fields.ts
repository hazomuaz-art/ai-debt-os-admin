// ════════════════════════════════════════════════════════════════════════
// Portfolio-specific customer data field registry.
//
// Each of the 12 known portfolios (see company-import-profiles.ts) has its
// own table (customer_data_<key suffix>, created in migration 022) with
// columns that don't exist anywhere else in the schema. This file is the
// single source of truth mapping:
//   profile key  →  table name  →  ordered list of fields
//
// Used by:
//   - src/app/api/debts/import/route.ts   (raw header → db column, on import)
//   - src/lib/actions/debts.ts            (manual entry → db column, on save)
//   - src/components/debt/PortfolioFieldsSection.tsx (dynamic form fields)
//   - debt/customer detail pages          (display)
//
// Plain data only — safe to import from both server and client code.
// ════════════════════════════════════════════════════════════════════════

export type PortfolioFieldType = 'text' | 'number' | 'date' | 'boolean'

export type PortfolioField = {
  column:        string              // DB column in customer_data_<table>
  label:         string              // Arabic label for forms/tables
  type:          PortfolioFieldType
  headerAliases: string[]            // lowercased raw header names seen on import
}

export type PortfolioTableConfig = {
  table:  string                     // e.g. "customer_data_mobily"
  fields: PortfolioField[]
}

export const PORTFOLIO_DATA_TABLES: Record<string, PortfolioTableConfig> = {
  mobily: {
    table: 'customer_data_mobily',
    fields: [
      { column: 'account_number', label: 'رقم الحساب',     type: 'text',   headerAliases: ['رقم الحساب', 'account number'] },
      { column: 'product_number', label: 'رقم المنتج',     type: 'text',   headerAliases: ['رقم المنتج'] },
      { column: 'product_type',   label: 'نوع المنتج',     type: 'text',   headerAliases: ['نوع المنتج'] },
      { column: 'category',       label: 'التصنيف',        type: 'text',   headerAliases: ['category'] },
      { column: 'status_date',    label: 'تاريخ الحالة',    type: 'date',   headerAliases: ['status_date'] },
      { column: 'mnp',            label: 'MNP',             type: 'text',   headerAliases: ['mnp'] },
      { column: 'id_type',        label: 'نوع الهوية',      type: 'text',   headerAliases: ['نوع الهوية'] },
      { column: 'created_date',   label: 'تاريخ الإنشاء',   type: 'date',   headerAliases: ['created_date'] },
      { column: 'discount',       label: 'الخصم',          type: 'number', headerAliases: ['discount'] },
      { column: 'city',           label: 'المدينة',         type: 'text',   headerAliases: ['city'] },
      { column: 'service_status', label: 'حالة الخدمة',     type: 'text',   headerAliases: ['service_status'] },
      { column: 'email',          label: 'البريد الإلكتروني', type: 'text', headerAliases: ['email'] },
      { column: 'nationality',    label: 'الجنسية',         type: 'text',   headerAliases: ['nationality'] },
      { column: 'sadad_number',   label: 'رقم سداد',        type: 'text',   headerAliases: ['sadad_number', 'sadad number', 'sadad _number'] },
    ],
  },
  stc: {
    table: 'customer_data_stc',
    fields: [
      { column: 'account_number',          label: 'رقم الحساب',           type: 'text', headerAliases: ['رقم الحساب'] },
      { column: 'product_number',          label: 'رقم المنتج',           type: 'text', headerAliases: ['رقم المنتج'] },
      { column: 'working_services_flag',   label: 'حالة الخدمات',         type: 'text', headerAliases: ['working_services_flag'] },
      { column: 'account_status_date',     label: 'تاريخ حالة الحساب',     type: 'date', headerAliases: ['account_status_date'] },
      { column: 'customer_established_dt', label: 'تاريخ تأسيس العميل',    type: 'date', headerAliases: ['customer_established_dt'] },
      { column: 'id_type',                 label: 'نوع الهوية',           type: 'text', headerAliases: ['نوع الهوية'] },
      { column: 'baqa_flag',               label: 'علامة باقة',           type: 'text', headerAliases: ['baqa_flag'] },
      { column: 'sadad_number',            label: 'رقم سداد',             type: 'text', headerAliases: ['sadad_number', 'sadad number'] },
    ],
  },
  saudi_energy: {
    table: 'customer_data_saudi_energy',
    fields: [
      { column: 'account_number',               label: 'رقم الحساب',         type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'product_number',               label: 'رقم المنتج',         type: 'text',   headerAliases: ['رقم المنتج'] },
      { column: 'account_type',                 label: 'نوع الحساب',         type: 'text',   headerAliases: ['نوع الحساب'] },
      { column: 'last_invoice_date',             label: 'تاريخ آخر فاتورة',   type: 'date',   headerAliases: ['last invoice date'] },
      { column: 'move_out_date',                label: 'تاريخ الانتقال',     type: 'date',   headerAliases: ['move-out date', 'move out date'] },
      { column: 'last_invoice_amount',           label: 'مبلغ آخر فاتورة',    type: 'number', headerAliases: ['last invoice amount'] },
      { column: 'open_bills_count',              label: 'عدد الفواتير المفتوحة', type: 'number', headerAliases: ['no of open bills'] },
      { column: 'department',                   label: 'القسم',             type: 'text',   headerAliases: ['department_5'] },
      { column: 'last_payment_date',             label: 'تاريخ آخر دفعة',     type: 'date',   headerAliases: ['last payment date'] },
      { column: 'mc_cc_indicator',               label: 'مؤشر MC/CC',        type: 'text',   headerAliases: ['mc/cc indicator'] },
      { column: 'email',                         label: 'البريد الإلكتروني', type: 'text',   headerAliases: ['e-mail address'] },
      { column: 'installation_blocking_reason',  label: 'سبب حظر التوصيل',    type: 'text',   headerAliases: ['installation blocking reason_3'] },
      { column: 'crn_owner_id',                  label: 'معرّف مالك CRN',     type: 'text',   headerAliases: ['crn owner id'] },
      { column: 'account_status',                label: 'حالة الحساب',        type: 'text',   headerAliases: ['account status'] },
      { column: 'mc_cc',                         label: 'MC/CC',             type: 'text',   headerAliases: ['mc/cc'] },
    ],
  },
  alam_tam: {
    table: 'customer_data_elm',
    fields: [
      { column: 'account_number',     label: 'رقم الحساب',          type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'account_type',       label: 'نوع الحساب',          type: 'text',   headerAliases: ['نوع الحساب'] },
      { column: 'year',               label: 'السنة',               type: 'number', headerAliases: ['year'] },
      { column: 'quarterly',          label: 'الربع',                type: 'text',   headerAliases: ['quarterly'] },
      { column: 'transactions_count', label: 'عدد المعاملات',        type: 'number', headerAliases: ['no of transactions'] },
      { column: 'end_date',           label: 'تاريخ الانتهاء',        type: 'date',   headerAliases: ['end date'] },
      { column: 'location',           label: 'الموقع',                type: 'text',   headerAliases: ['الموقع'] },
      { column: 'owner_national_id',  label: 'رقم هوية المالك',       type: 'text',   headerAliases: ['رقم هوية المالك'] },
      { column: 'owner_name',         label: 'اسم المالك',           type: 'text',   headerAliases: ['اسم المالك'] },
      { column: 'primary_user_name',  label: 'اسم المستخدم الرئيسي', type: 'text',   headerAliases: ['اسم المستخدم الرئيسي'] },
    ],
  },
  national_water: {
    table: 'customer_data_national_water',
    fields: [
      { column: 'account_number',       label: 'رقم الحساب',       type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'drainage_agreement',   label: 'اتفاقية الصرف',     type: 'text',   headerAliases: ['اتفاقية الصرف'] },
      { column: 'coordinates',          label: 'الإحداثية',         type: 'text',   headerAliases: ['الإحداثية'] },
      { column: 'region',               label: 'المنطقة',           type: 'text',   headerAliases: ['المنطقة'] },
      { column: 'last_invoice_date',    label: 'آخر تاريخ فاتورة',   type: 'date',   headerAliases: ['آخر تاريخ فاتورة'] },
      { column: 'customer_category',    label: 'تصنيف العميل',      type: 'text',   headerAliases: ['تصنيف العميل'] },
      { column: 'water_agreement',      label: 'اتفاقية الماء',      type: 'text',   headerAliases: ['اتفاقية الماء'] },
      { column: 'last_payment_date',    label: 'آخر تاريخ دفع',      type: 'date',   headerAliases: ['آخر تاريخ دفع'] },
      { column: 'city',                 label: 'المدينة',           type: 'text',   headerAliases: ['المدينة'] },
      { column: 'last_payment_amount',  label: 'آخر دفع',           type: 'number', headerAliases: ['آخر دفع'] },
    ],
  },
  taawuniya: {
    table: 'customer_data_tawuniya',
    fields: [
      { column: 'account_number',     label: 'رقم الحساب',       type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'product_number',     label: 'رقم المنتج',       type: 'text',   headerAliases: ['رقم المنتج'] },
      { column: 'product_type',       label: 'نوع المنتج',       type: 'text',   headerAliases: ['نوع المنتج'] },
      { column: 'owner_mobile',       label: 'رقم جوال المالك',   type: 'text',   headerAliases: ['رقم جوال المالك'] },
      { column: 'recovery_number',    label: 'رقم الاسترداد',     type: 'text',   headerAliases: ['رقم الاسترداد'] },
      { column: 'accident_city',      label: 'مدينة الحادث',      type: 'text',   headerAliases: ['مدينة الحادث'] },
      { column: 'accident_date',      label: 'تاريخ الحادث',      type: 'date',   headerAliases: ['تاريخ الحادث'] },
      { column: 'owner_name',         label: 'اسم المالك',        type: 'text',   headerAliases: ['اسم المالك'] },
      { column: 'vehicle_type',       label: 'نوع السيارة',       type: 'text',   headerAliases: ['نوع السيارة'] },
      { column: 'fault_percentage',   label: 'نسبة الخطأ',        type: 'number', headerAliases: ['نسبه الخطا'] },
      { column: 'plate_number',       label: 'لوحة السيارة',      type: 'text',   headerAliases: ['لوحة السيارة'] },
      { column: 'owner_national_id',  label: 'رقم هوية المالك',   type: 'text',   headerAliases: ['رقم هوية المالك'] },
      { column: 'traffic_dept',       label: 'المرور',            type: 'text',   headerAliases: ['المرور'] },
      { column: 'recourse_reason',    label: 'سبب حق الرجوع',     type: 'text',   headerAliases: ['سبب حق الرجوع'] },
    ],
  },
  midgulf: {
    table: 'customer_data_medgulf',
    fields: [
      { column: 'account_number',    label: 'رقم الحساب',     type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'product_number',    label: 'رقم المنتج',     type: 'text',   headerAliases: ['رقم المنتج'] },
      { column: 'product_type',      label: 'نوع المنتج',     type: 'text',   headerAliases: ['نوع المنتج'] },
      { column: 'accident_city',     label: 'مدينة الحادث',    type: 'text',   headerAliases: ['مدينة الحادث'] },
      { column: 'vehicle_type',      label: 'نوع السيارة',     type: 'text',   headerAliases: ['نوع السيارة'] },
      { column: 'owner_mobile',      label: 'رقم جوال المالك', type: 'text',   headerAliases: ['رقم جوال المالك'] },
      { column: 'owner_name',        label: 'اسم المالك',     type: 'text',   headerAliases: ['اسم المالك'] },
      { column: 'traffic_dept',      label: 'المرور',          type: 'text',   headerAliases: ['المرور'] },
      { column: 'fault_percentage',  label: 'نسبة الخطأ',      type: 'number', headerAliases: ['نسبه الخطا'] },
      { column: 'accident_number',   label: 'رقم الحادث',      type: 'text',   headerAliases: ['رقم الحادث'] },
      { column: 'recourse_reason',   label: 'سبب حق الرجوع',   type: 'text',   headerAliases: ['سبب حق الرجوع'] },
      { column: 'plate_number',      label: 'لوحة السيارة',    type: 'text',   headerAliases: ['لوحة السيارة'] },
      { column: 'accident_date',     label: 'تاريخ الحادث',    type: 'date',   headerAliases: ['تاريخ الحادث'] },
      { column: 'owner_national_id', label: 'رقم هوية المالك', type: 'text',   headerAliases: ['رقم هوية المالك'] },
      { column: 'da',                label: 'DA',              type: 'text',   headerAliases: ['da'] },
    ],
  },
  mahara_recruitment: {
    table: 'customer_data_mahara',
    fields: [
      { column: 'account_number',      label: 'رقم الحساب',          type: 'text',   headerAliases: ['رقم الحساب'] },
      { column: 'branch',              label: 'الفرع',                type: 'text',   headerAliases: ['الفرع'] },
      { column: 'last_paid_amount',    label: 'آخر مبلغ تم سداده',     type: 'number', headerAliases: ['اخر مبلغ تم سداده'] },
      { column: 'worker_nationality',  label: 'جنسية العامل',         type: 'text',   headerAliases: ['جنسية العامل'] },
      { column: 'nationality',         label: 'الجنسية',              type: 'text',   headerAliases: ['الجنسية'] },
      { column: 'legal_notes',         label: 'ملاحظات قانونية',       type: 'text',   headerAliases: ['ملاحظات القانونية'] },
      { column: 'employer',            label: 'جهة العمل',            type: 'text',   headerAliases: ['جهة العمل'] },
      { column: 'workers_count',       label: 'عدد العمالة',          type: 'number', headerAliases: ['عدد العماله'] },
      { column: 'worker_name',         label: 'اسم العامل',           type: 'text',   headerAliases: ['اسم العامل'] },
      { column: 'worker_gender',       label: 'جنس العامل',           type: 'text',   headerAliases: ['جنس العمل'] },
      { column: 'city',                label: 'المدينة',              type: 'text',   headerAliases: ['المدينة'] },
      { column: 'contract_end_date',   label: 'تاريخ انتهاء التعاقد',   type: 'date',   headerAliases: ['تاريخ انتهاء التعاقد'] },
      { column: 'contract_status',     label: 'حالة العقد',           type: 'text',   headerAliases: ['حالة العقد'] },
      { column: 'worker_status',       label: 'حالة العامل',          type: 'text',   headerAliases: ['حالة العامل'] },
      { column: 'recommendation',      label: 'التوصية',              type: 'text',   headerAliases: ['التوصية'] },
      { column: 'last_payment_date',   label: 'تاريخ آخر سداد',        type: 'date',   headerAliases: ['تاريخ اخر سداد'] },
      { column: 'address',             label: 'العنوان',              type: 'text',   headerAliases: ['العنوان'] },
      { column: 'contract_start_date', label: 'تاريخ بداية التعاقد',   type: 'date',   headerAliases: ['تاريخ بداية التعاقد'] },
      { column: 'request_date_hijri',  label: 'تاريخ الطلب هجري',      type: 'text',   headerAliases: ['تاريخ الطلب هجري'] },
      { column: 'decisions',           label: 'القرارات',             type: 'text',   headerAliases: ['القرارت'] },
      { column: 'emails',              label: 'الأيميلات',            type: 'text',   headerAliases: ['الأيميلات'] },
    ],
  },
  wafrh: {
    table: 'customer_data_wafrh',
    fields: [
      { column: 'account_number', label: 'رقم الحساب', type: 'text', headerAliases: ['رقم الحساب'] },
      { column: 'agent_name',     label: 'المندوب',     type: 'text', headerAliases: ['المندوب'] },
      { column: 'city',           label: 'المدينة',     type: 'text', headerAliases: ['المدينة'] },
    ],
  },
  tanmiya_agri: {
    table: 'customer_data_agri_dev',
    fields: [
      { column: 'account_number',      label: 'رقم الحساب',           type: 'text',    headerAliases: ['رقم الحساب'] },
      { column: 'account_type',        label: 'نوع الحساب',           type: 'text',    headerAliases: ['نوع الحساب'] },
      { column: 'legal_action_taken',  label: 'تم اتخاذ إجراء قانوني', type: 'boolean', headerAliases: ['تم اتخاذ إجراء قانوني'] },
      { column: 'debt_date',           label: 'تاريخ المديونية',       type: 'date',    headerAliases: ['تاريخ المديونية'] },
      { column: 'city',                label: 'المدينة',              type: 'text',    headerAliases: ['المدينة'] },
      { column: 'email',               label: 'البريد الإلكتروني',     type: 'text',    headerAliases: ['email'] },
    ],
  },
  arabian_fisheries: {
    table: 'customer_data_fisheries',
    fields: [
      { column: 'account_number',      label: 'رقم الحساب',           type: 'text',    headerAliases: ['رقم الحساب'] },
      { column: 'account_type',        label: 'نوع الحساب',           type: 'text',    headerAliases: ['نوع الحساب'] },
      { column: 'debt_date',           label: 'تاريخ المديونية',       type: 'date',    headerAliases: ['تاريخ المديونية'] },
      { column: 'legal_action_taken',  label: 'تم اتخاذ إجراء قانوني', type: 'boolean', headerAliases: ['تم اتخاذ إجراء قانوني'] },
      { column: 'agent_name',          label: 'المندوب',              type: 'text',    headerAliases: ['المندوب'] },
      { column: 'city',                label: 'المدينة',              type: 'text',    headerAliases: ['المدينة'] },
    ],
  },
  kunhul_agri: {
    table: 'customer_data_kanahel',
    fields: [
      { column: 'account_number',  label: 'رقم الحساب',     type: 'text', headerAliases: ['رقم الحساب'] },
      { column: 'customer_status', label: 'حالة العميل',     type: 'text', headerAliases: ['حالة العميل'] },
      { column: 'proof_of_dues',   label: 'إثبات المديونية', type: 'text', headerAliases: ['proof of dues'] },
      { column: 'reasons_of_dues', label: 'سبب المديونية',   type: 'text', headerAliases: ['reasons of the dues'] },
      { column: 'customer_city',   label: 'مدينة العميل',    type: 'text', headerAliases: ['customer city'] },
    ],
  },
}

export function getPortfolioTableConfig(companyKey: string | null | undefined): PortfolioTableConfig | null {
  if (!companyKey) return null
  return PORTFOLIO_DATA_TABLES[companyKey] ?? null
}
