export type IntegrationFieldType = 'text' | 'password' | 'url'
export type IntegrationIcon = 'message-circle' | 'settings' | 'link' | 'phone-call' | 'message-square'

export interface IntegrationFieldDefinition {
  key: string
  label: string
  placeholder: string
  type?: IntegrationFieldType
  hint?: string
  required?: boolean
}

export interface IntegrationDefinition {
  label: string
  description: string
  icon: IntegrationIcon
  fields: readonly IntegrationFieldDefinition[]
}

/**
 * Authoritative integration registry.
 *
 * Database values, API validation, configuration fields, and the admin UI
 * all derive from this object. Add or rename an integration here first.
 */
export const INTEGRATION_CATALOG = {
  waha: {
    label: 'WAHA WhatsApp',
    description: 'ربط واتساب عبر WAHA لاستقبال وإرسال الرسائل والمفاوضات.',
    icon: 'message-circle',
    fields: [
      { key: 'api_url', label: 'رابط الخادم (WAHA URL)', type: 'url', placeholder: 'https://waha.yourdomain.com' },
      { key: 'api_key', label: 'مفتاح الـ API', type: 'password', placeholder: 'WAHA API Key' },
      { key: 'session', label: 'اسم الجلسة (Session)', type: 'text', placeholder: 'default' },
    ],
  },
  n8n_automation: {
    label: 'n8n Automation',
    description: 'ربط خوادم الأتمتة n8n لبرمجة مسارات العمل المتكررة وتزامن البيانات.',
    icon: 'settings',
    fields: [
      { key: 'webhook_url', label: 'رابط ويب هوك (n8n Webhook URL)', type: 'url', placeholder: 'https://n8n.yourdomain.com/webhook/...' },
      { key: 'auth_token', label: 'رمز التوثيق (Auth Token)', type: 'password', placeholder: 'Secret token used in header' },
    ],
  },
  collection_api: {
    label: 'أنظمة التحصيل والمحاسبة (ERP)',
    description: 'ربط ثنائي الاتجاه لمزامنة الديون والعملاء وسجلات السداد.',
    icon: 'link',
    fields: [
      { key: 'base_url', label: 'رابط واجهة برمجة تطبيقات التحصيل', type: 'url', placeholder: 'https://api.collectionsystem.io' },
      { key: 'username', label: 'اسم المستخدم', type: 'text', placeholder: 'Service account username' },
      { key: 'token', label: 'كلمة المرور / الرمز', type: 'password', placeholder: 'Password or API token' },
    ],
  },
  tameez_calls: {
    label: 'Tameez Calls',
    description: 'ربط نظام تميز لتحليل وتسجيل المكالمات الصوتية مع العملاء.',
    icon: 'phone-call',
    fields: [
      { key: 'api_url', label: 'رابط الخادم (Tameez Calls URL)', type: 'url', placeholder: 'https://tameez.yourdomain.com' },
      { key: 'api_key', label: 'مفتاح الـ API', type: 'password', placeholder: 'Tameez API Key' },
    ],
  },
  rasf_whatsapp: {
    label: 'InSync / Rasf WhatsApp',
    description: 'ربط واتساب عبر بوابة رصف (InSync) كقناة بديلة لاستقبال وإرسال الرسائل.',
    icon: 'message-square',
    fields: [
      { key: 'api_url', label: 'رابط الخادم (InSync/Rasf URL)', type: 'url', placeholder: 'https://rasf.yourdomain.com' },
      { key: 'token', label: 'رمز التوثيق (Token)', type: 'password', placeholder: 'Bearer token' },
      { key: 'sender_id', label: 'معرّف المرسل', type: 'text', placeholder: 'Sender ID', hint: 'اختياري', required: false },
    ],
  },
} as const satisfies Record<string, IntegrationDefinition>

export type IntegrationName = keyof typeof INTEGRATION_CATALOG

export const INTEGRATION_NAMES = Object.keys(INTEGRATION_CATALOG) as [
  IntegrationName,
  ...IntegrationName[],
]

export const INTEGRATION_DEFINITIONS = Object.entries(INTEGRATION_CATALOG).map(
  ([name, definition]) => ({ name: name as IntegrationName, ...definition }),
)
