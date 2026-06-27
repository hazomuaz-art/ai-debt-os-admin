import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { IntegrationCard } from '@/components/integrations/IntegrationCard'
import { MessageCircle, Settings, Link as LinkIcon, PhoneCall, MessageSquare } from 'lucide-react'
import type { IntegrationSetting } from '@/types'

// ── Integration catalogue ──

const INTEGRATIONS = [
  {
    key:         'waha',
    label:       'WAHA WhatsApp',
    description: 'ربط واتساب عبر WAHA لاستقبال وإرسال الرسائل والمفاوضات.',
    icon:        <MessageCircle size={24} className="text-white" />,
  },
  {
    key:         'n8n_automation',
    label:       'n8n Automation',
    description: 'ربط خوادم الأتمتة n8n لبرمجة مسارات العمل المتكررة وتزامن البيانات.',
    icon:        <Settings size={24} className="text-white" />,
  },
  {
    key:         'collection_api',
    label:       'أنظمة التحصيل والمحاسبة (ERP)',
    description: 'ربط ثنائي الاتجاه لمزامنة الديون والعملاء وسجلات السداد.',
    icon:        <LinkIcon size={24} className="text-white" />,
  },
  {
    key:         'tameez_calls',
    label:       'Tameez Calls',
    description: 'ربط نظام تميز لتحليل وتسجيل المكالمات الصوتية مع العملاء.',
    icon:        <PhoneCall size={24} className="text-white" />,
  },
  {
    key:         'rasf_whatsapp',
    label:       'InSync / Rasf WhatsApp',
    description: 'ربط واتساب عبر بوابة رصف (InSync) كقناة بديلة لاستقبال وإرسال الرسائل.',
    icon:        <MessageSquare size={24} className="text-white" />,
  },
]

// ── Page ──

export default async function IntegrationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/admin')

  // Load existing integration settings
  const { data: settings, error: settingsErr } = await supabase
    .from('integration_settings')
    .select('*')
    .eq('company_id', profile.company_id)

  const settingsMap = new Map<string, IntegrationSetting>(
    (settings ?? []).map(s => [s.integration_name, s as IntegrationSetting])
  )

  const enabledCount  = (settings ?? []).filter(s => s.enabled).length

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-8 bg-[#0b0e14] font-sans text-slate-100" >
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">إدارة الربط (Integrations)</h1>
          <p className="text-[#8b95a7] text-sm">
            قم بربط الأنظمة الخارجية لتفعيل الذكاء الاصطناعي والمراسلات وأتمتة المهام بكل سهولة.
          </p>
        </div>
        <div className="bg-[#0d1117] px-4 py-3 rounded-xl border border-blue-100 flex items-center gap-2">
          <div className="w-3 h-3 bg-[#0e7a54] rounded-full animate-pulse"></div>
          <span className="text-white font-bold text-sm">
            {enabledCount} من {INTEGRATIONS.length} قيد التشغيل
          </span>
        </div>
      </div>

      {/* Integration cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {INTEGRATIONS.map(integration => (
          <IntegrationCard
            key={integration.key}
            name={integration.key}
            label={integration.label}
            description={integration.description}
            icon={integration.icon}
            integrationKey={integration.key}
            initial={settingsMap.get(integration.key) ?? null}
          />
        ))}
      </div>
      
      {/* Docs footer */}
      <div className="bg-[#0e7a54] text-white rounded-2xl p-6 shadow-md flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg mb-1">تحتاج مساعدة في الربط؟</h3>
          <p className="text-blue-200 text-sm">
            يمكنك دائماً الرجوع إلى مركز المساعدة والتوثيق لمعرفة كيفية إعداد WAHA ومسارات n8n بشكل صحيح.
          </p>
        </div>
        <a
          href="#"
          className="px-6 py-2 bg-[#151a23] text-white hover:bg-blue-50 font-bold rounded-xl text-sm transition-colors shrink-0"
        >
          تصفح الوثائق ↗
        </a>
      </div>
    </div>
  )
}
