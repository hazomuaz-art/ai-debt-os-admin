'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Campaign } from '@/types'
import { Megaphone, MessageSquare, PlayCircle, Smartphone, Activity, Link as LinkIcon, Plus, QrCode, Target } from 'lucide-react'

type Portfolio = {
  id: string
  name: string
  name_ar?: string | null
  code?: string | null
  category?: string | null
}

type PortfolioWhatsappNumber = {
  id: string
  portfolio_id: string
  display_name?: string | null
  phone_number: string
  provider: string
  instance_name: string
  is_active: boolean
  daily_limit: number
  sent_today: number
  portfolio?: Portfolio | null
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-[#222a36] text-[#8b95a7] border-[#222a36]',
  scheduled: 'bg-blue-50 text-blue-600 border-blue-200',
  running: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  paused: 'bg-amber-50 text-amber-600 border-amber-200',
  completed: 'bg-purple-50 text-purple-600 border-purple-200',
  cancelled: 'bg-rose-50 text-rose-600 border-rose-200',
}

const STATUS_ARABIC: Record<string, string> = {
  draft: 'مسودة',
  scheduled: 'مجدول',
  running: 'قيد التشغيل',
  paused: 'متوقف مؤقتاً',
  completed: 'مكتمل',
  cancelled: 'ملغى',
}

const TYPE_LABELS: Record<string, string> = {
  overdue_90: 'متأخر 90 يوماً',
  pre_salary: 'قبل الراتب',
  post_holiday: 'بعد الإجازة',
  settlement: 'تسوية',
  reminder: 'تذكير ودي',
  custom: 'مخصص',
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [numbers, setNumbers] = useState<PortfolioWhatsappNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [showNumberForm, setShowNumberForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Connection states for WhatsApp instances
  const [activeQr, setActiveQr] = useState<{ numberId: string; qrCode?: string; pairingCode?: string } | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [connectionStates, setConnectionStates] = useState<Record<string, 'open' | 'close' | 'connecting' | 'loading'>>({})

  const [campaignForm, setCampaignForm] = useState({
    name: '',
    campaign_type: 'reminder',
    message_template: '',
    portfolio_id: '',
  })
  const [runningCampaignId, setRunningCampaignId] = useState<string | null>(null)

  const [numberForm, setNumberForm] = useState({
    portfolio_id: '',
    display_name: '',
    phone_number: '',
    instance_name: 'ai-debt-main',
    api_url: 'http://72.62.30.109:32769',
    daily_limit: 250,
  })

  const fetchConnectionStatuses = useCallback(async (numbersList: PortfolioWhatsappNumber[]) => {
    for (const num of numbersList) {
      setConnectionStates(prev => ({ ...prev, [num.id]: 'loading' }))
      try {
        const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${num.id}`)
        const json = await res.json() as { success: boolean; state?: 'open' | 'close' | 'connecting' }
        if (json.success && json.state) {
          setConnectionStates(prev => ({ ...prev, [num.id]: json.state! }))
        } else {
          setConnectionStates(prev => ({ ...prev, [num.id]: 'close' }))
        }
      } catch (e) {
        setConnectionStates(prev => ({ ...prev, [num.id]: 'close' }))
      }
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [campaignsRes, portfoliosRes, numbersRes] = await Promise.all([
        fetch('/api/modules/campaigns'),
        fetch('/api/portfolios'),
        fetch('/api/portfolio-whatsapp-numbers'),
      ])

      const campaignsJson = await campaignsRes.json() as { data?: Campaign[] }
      const portfoliosJson = await portfoliosRes.json() as { data?: Portfolio[] }
      const numbersJson = await numbersRes.json() as { data?: PortfolioWhatsappNumber[] }

      setCampaigns(campaignsJson.data ?? [])
      setPortfolios(portfoliosJson.data ?? [])
      setNumbers(numbersJson.data ?? [])
      void fetchConnectionStatuses(numbersJson.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [fetchConnectionStatuses])

  useEffect(() => {
    void load()
  }, [load])

  // Poll for connection state changes when QR is active
  useEffect(() => {
    if (!activeQr || !activeQr.qrCode) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${activeQr.numberId}`)
        const json = await res.json() as { success: boolean; state?: 'open' | 'close' | 'connecting' }
        if (json.success && json.state === 'open') {
          setActiveQr(null)
          clearInterval(interval)
          alert('تم ربط الواتساب بنجاح!')
          await load()
        }
      } catch (e) {
        console.error('Error polling connection state', e)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [activeQr, load])

  async function handleConnect(numberId: string) {
    setQrLoading(true)
    setActiveQr({ numberId })
    try {
      const res = await fetch('/api/portfolio-whatsapp-numbers/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: numberId }),
      })
      const json = await res.json() as { success: boolean; base64?: string; pairingCode?: string; code?: string }
      if (res.ok && json.success) {
        setActiveQr({
          numberId,
          qrCode: json.base64 || json.code,
          pairingCode: json.pairingCode
        })
      } else {
        alert('فشل في إنشاء رمز الاستجابة السريعة (QR Code). يرجى التحقق من إعدادات WAHA.')
        setActiveQr(null)
      }
    } catch (e) {
      alert('فشل في الاتصال')
      setActiveQr(null)
    } finally {
      setQrLoading(false)
    }
  }

  async function handleDisconnect(numberId: string) {
    if (!confirm('هل أنت متأكد أنك تريد قطع الاتصال بهذا الرقم؟')) return
    setConnectionStates(prev => ({ ...prev, [numberId]: 'loading' }))
    try {
      const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${numberId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setConnectionStates(prev => ({ ...prev, [numberId]: 'close' }))
        await load()
      } else {
        alert('فشل في قطع الاتصال')
        void fetchConnectionStatuses(numbers)
      }
    } catch (e) {
      alert('فشل في قطع الاتصال')
      void fetchConnectionStatuses(numbers)
    }
  }

  const totalCollected = useMemo(
    () => campaigns.reduce((sum, campaign) => sum + Number(campaign.total_collected ?? 0), 0),
    [campaigns]
  )

  const runningCampaigns = campaigns.filter(c => c.status === 'running').length
  const activeNumbers = numbers.filter(n => n.is_active).length
  const dailyCapacity = numbers.reduce((sum, n) => sum + Number(n.daily_limit ?? 0), 0)
  const sentToday = numbers.reduce((sum, n) => sum + Number(n.sent_today ?? 0), 0)

  async function handleAddCampaign(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/modules/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...campaignForm, portfolio_id: campaignForm.portfolio_id || null, status: 'draft', channels: ['whatsapp'] }),
      })
      setCampaignForm({ name: '', campaign_type: 'reminder', message_template: '', portfolio_id: '' })
      setShowCampaignForm(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function handleRunCampaign(campaign: Campaign) {
    if (!(campaign as any).portfolio_id) { alert('هذي الحملة بلا محفظة محدّدة — افتح حملة جديدة واختر المحفظة.'); return }
    if (!confirm(`تشغيل حملة "${campaign.name}"؟ سيتم بناء قائمة المستهدفين وإضافتهم لطابور الإرسال الفعلي.`)) return
    setRunningCampaignId(campaign.id)
    try {
      const res = await fetch('/api/campaign-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaign.id, portfolio_id: (campaign as any).portfolio_id }),
      })
      const json = await res.json() as { data?: { recipients_created: number; queue_created: number; message?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'فشل تشغيل الحملة')
      alert(json.data?.message ?? `تم جدولة ${json.data?.queue_created ?? 0} رسالة للإرسال. سيتم إرسالها تلقائياً عبر طابور المعالجة الخلفي.`)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'فشل تشغيل الحملة')
    } finally {
      setRunningCampaignId(null)
    }
  }

  async function handleAddNumber(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/portfolio-whatsapp-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...numberForm,
          provider: 'waha',
          daily_limit: Number(numberForm.daily_limit),
          is_active: true,
          metadata: {},
        }),
      })
      setNumberForm({
        portfolio_id: '',
        display_name: '',
        phone_number: '',
        instance_name: 'ai-debt-main',
        api_url: 'http://72.62.30.109:32769',
        daily_limit: 250,
      })
      setShowNumberForm(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <Megaphone size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">محرك الحملات التسويقية (Campaign Engine)</h1>
            <p className="text-[#8b95a7] text-sm">إدارة حملات التحصيل، أرقام الواتساب للمشاريع، وتنظيم طوابير الإرسال.</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setShowNumberForm(p => !p)} className="bg-[#151a23] hover:bg-[#1a212c] border border-[#222a36] text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
            {showNumberForm ? 'إلغاء الرقم' : <><LinkIcon size={18} /> ربط رقم واتساب</>}
          </button>
          <button onClick={() => setShowCampaignForm(p => !p)} className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
            {showCampaignForm ? 'إلغاء الحملة' : <><Plus size={18} /> حملة جديدة</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5">
          <div className="text-[#8b95a7] text-sm font-bold mb-1">إجمالي الحملات</div>
          <div className="text-3xl font-bold text-white">{campaigns.length}</div>
        </div>
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5">
          <div className="text-[#8b95a7] text-sm font-bold mb-1">حملات نشطة (جارية)</div>
          <div className="text-3xl font-bold text-emerald-500">{runningCampaigns}</div>
        </div>
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5">
          <div className="text-[#8b95a7] text-sm font-bold mb-1">أرقام واتساب الفعالة</div>
          <div className="text-3xl font-bold text-blue-500">{activeNumbers}</div>
        </div>
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5">
          <div className="text-[#8b95a7] text-sm font-bold mb-1">القدرة الاستيعابية اليومية</div>
          <div className="text-3xl font-bold text-purple-500">{String(dailyCapacity)}</div>
        </div>
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5">
          <div className="text-[#8b95a7] text-sm font-bold mb-1">تم إرساله اليوم</div>
          <div className="text-3xl font-bold text-orange-500">{String(sentToday)}</div>
        </div>
      </div>

      {showNumberForm && (
        <form onSubmit={handleAddNumber} className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5 animate-in fade-in slide-in-from-top-2">
          <div className="font-bold text-lg text-white border-b border-[#222a36] pb-3 flex items-center gap-2">
            <MessageSquare size={18} className="text-emerald-500" />
            ربط رقم واتساب جديد بمحفظة (Portfolio)
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">المشروع / المحفظة *</label>
              <select required className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.portfolio_id}
                onChange={e => setNumberForm(p => ({ ...p, portfolio_id: e.target.value }))}>
                <option value="">اختر المشروع...</option>
                {portfolios.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} - ` : ''}{p.name_ar || p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">الاسم الرمزي (اختياري)</label>
              <input className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.display_name}
                onChange={e => setNumberForm(p => ({ ...p, display_name: e.target.value }))}
                placeholder="مثال: واتساب موبايلي" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">رقم الهاتف *</label>
              <input required className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.phone_number}
                onChange={e => setNumberForm(p => ({ ...p, phone_number: e.target.value }))}
                placeholder="9665XXXXXXXX" dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">اسم جلسة WAHA *</label>
              <input required className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.instance_name}
                onChange={e => setNumberForm(p => ({ ...p, instance_name: e.target.value }))} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">رابط الخادم (WAHA API URL)</label>
              <input className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.api_url}
                onChange={e => setNumberForm(p => ({ ...p, api_url: e.target.value }))} dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">الحد الأقصى للإرسال اليومي</label>
              <input type="number" min={1} max={5000} className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={numberForm.daily_limit}
                onChange={e => setNumberForm(p => ({ ...p, daily_limit: Number(e.target.value) }))} />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-8 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
              {saving ? 'جارٍ الحفظ…' : 'حفظ بيانات الرقم'}
            </button>
          </div>
        </form>
      )}

      {showCampaignForm && (
        <form onSubmit={handleAddCampaign} className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5 animate-in fade-in slide-in-from-top-2">
          <div className="font-bold text-lg text-white border-b border-[#222a36] pb-3 flex items-center gap-2">
            <Megaphone size={18} className="text-blue-500" />
            صياغة مسودة حملة جديدة
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">اسم الحملة *</label>
              <input required className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={campaignForm.name}
                onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
                placeholder="حملة العيد، حملة الرواتب..." />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">نوع الحملة</label>
              <select className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={campaignForm.campaign_type}
                onChange={e => setCampaignForm(p => ({ ...p, campaign_type: e.target.value }))}>
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">المحفظة المستهدَفة *</label>
              <select required className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                value={campaignForm.portfolio_id}
                onChange={e => setCampaignForm(p => ({ ...p, portfolio_id: e.target.value }))}>
                <option value="">اختر المحفظة...</option>
                {portfolios.map(p => (
                  <option key={p.id} value={p.id}>{p.code ? `${p.code} - ` : ''}{p.name_ar || p.name}</option>
                ))}
              </select>
              <div className="text-[#5f6b7e] text-xs">يجب أن يكون لهذي المحفظة رقم واتساب مربوط (أعلى الصفحة) قبل تشغيل الحملة.</div>
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-bold text-[#8b95a7] ps-2">قالب الرسالة الافتتاحية</label>
              <textarea rows={3} className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54] resize-none"
                placeholder="اكتب رسالة الواتساب الأولى التي سيبدأ بها الذكاء الاصطناعي محادثته..."
                value={campaignForm.message_template}
                onChange={e => setCampaignForm(p => ({ ...p, message_template: e.target.value }))} />
            </div>
          </div>

          <div className="bg-amber-50 text-amber-600 px-4 py-3 rounded-xl text-xs font-bold border border-amber-100 flex items-center gap-2">
            ستُحفظ الحملة في حالة (مسودة). يمكنك لاحقاً تفعيلها وتشغيل منظم طوابير الإرسال (Queue Worker).
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-8 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
              {saving ? 'جارٍ الحفظ…' : 'إنشاء الحملة (مسودة)'}
            </button>
          </div>
        </form>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6">
          <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-4">
            <Smartphone className="text-white" size={20} />
            <div>
              <h2 className="text-lg font-bold text-white">أرقام الواتساب المرتبطة بالمشاريع</h2>
              <div className="text-[#8b95a7] text-xs mt-0.5">يمكن تخصيص رقم منفصل وحد إرسال لكل محفظة.</div>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div></div>
          ) : numbers.length === 0 ? (
            <div className="text-[#5f6b7e] text-sm py-8 text-center font-bold">لا توجد أرقام واتساب مرتبطة بعد.</div>
          ) : (
            <div className="space-y-4">
              {numbers.map(number => (
                <div key={number.id} className="rounded-2xl border border-[#222a36] bg-[#0d1117] p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-white text-base">{number.display_name || number.phone_number}</div>
                      <div className="text-[#8b95a7] text-sm mt-1">
                        {number.portfolio?.code ? `${number.portfolio.code} - ` : ''}
                        {number.portfolio?.name_ar || number.portfolio?.name || 'محفظة غير معروفة'}
                      </div>
                      <div className="text-[#5f6b7e] text-xs mt-1 font-mono">
                        {number.provider} / {number.instance_name}
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1 ${
                      connectionStates[number.id] === 'open' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                      connectionStates[number.id] === 'connecting' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                      connectionStates[number.id] === 'loading' ? 'bg-[#222a36] text-[#8b95a7] border-[#222a36] animate-pulse' :
                      'bg-rose-50 text-rose-600 border-rose-200'
                    }`}>
                      {connectionStates[number.id] === 'open' ? 'متصل' :
                       connectionStates[number.id] === 'connecting' ? 'بانتظار المسح (QR)' :
                       connectionStates[number.id] === 'loading' ? 'جاري التحقق...' :
                       'مقطوع الاتصال'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
                    <div className="rounded-xl bg-[#0b0e14] border border-[#222a36] p-3 text-center">
                      <div className="text-[#8b95a7] font-bold text-xs mb-1">الحد اليومي</div>
                      <div className="font-bold text-white text-lg font-mono">{String(Number(number.daily_limit ?? 0))}</div>
                    </div>
                    <div className="rounded-xl bg-[#0b0e14] border border-[#222a36] p-3 text-center">
                      <div className="text-[#8b95a7] font-bold text-xs mb-1">تم الإرسال</div>
                      <div className="font-bold text-blue-600 text-lg font-mono">{String(Number(number.sent_today ?? 0))}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-5 justify-end">
                    {connectionStates[number.id] === 'open' ? (
                      <button onClick={() => handleDisconnect(number.id)}
                        className="text-xs font-bold text-rose-600 hover:text-white border border-rose-200 hover:border-transparent hover:bg-rose-500 px-4 py-2 rounded-xl transition-colors">
                        قطع الاتصال
                      </button>
                    ) : connectionStates[number.id] === 'loading' ? (
                      <span className="text-[#5f6b7e] text-xs py-2 font-bold">يتحقق من الخادم...</span>
                    ) : (
                      <button onClick={() => handleConnect(number.id)}
                        className="text-xs font-bold text-emerald-600 hover:text-white border border-emerald-200 hover:border-transparent hover:bg-emerald-500 px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5">
                        <QrCode size={14} /> ربط الرقم (إظهار الباركود)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6">
          <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-4">
            <Activity className="text-white" size={20} />
            <div>
              <h2 className="text-lg font-bold text-white">بنية الطوابير والقواعد (Queue Foundation)</h2>
              <div className="text-[#8b95a7] text-xs mt-0.5">ضمان التوزيع العادل وحماية النظام من الحظر.</div>
            </div>
          </div>

          <div className="space-y-4 text-sm mt-6">
            <div className="rounded-2xl border border-[#222a36] bg-[#0d1117] p-5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">🛑</div>
              <div>
                <div className="font-bold text-white">قواعد الإيقاف التلقائي</div>
                <div className="text-[#8b95a7] text-xs mt-1 leading-relaxed">يتوقف الواتساب فوراً عن إرسال الرسائل التلقائية إذا قام العميل بالرد، ادعاء الدفع، تقديم اعتراض، أو الدخول في وعد سداد.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#222a36] bg-[#0d1117] p-5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">⏳</div>
              <div>
                <div className="font-bold text-white">التدفق الآمن (Throttling)</div>
                <div className="text-[#8b95a7] text-xs mt-1 leading-relaxed">جدولة الرسائل بفاصل زمني ديناميكي يمنع حظر الواتساب ويتوافق مع سياسات شركة Meta للرسائل التسويقية.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#222a36] bg-[#0d1117] p-5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-50 text-purple-500 flex items-center justify-center shrink-0">🗂️</div>
              <div>
                <div className="font-bold text-white">العزل الذكي للمحافظ</div>
                <div className="text-[#8b95a7] text-xs mt-1 leading-relaxed">لا تتداخل بيانات الحملات الخاصة بالاتصالات مع البنوك، كل محفظة تعمل باستقلال تام برقم واتساب مخصص لها.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6">
        <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-4">
          <PlayCircle className="text-white" size={20} />
          <div>
            <h2 className="text-lg font-bold text-white">سجل الحملات (Campaigns Log)</h2>
            <div className="text-[#8b95a7] text-xs mt-0.5">المسودات، الحملات المجدولة، ونتائج التحصيل المالية المباشرة.</div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div></div>
        ) : (
          <div className="space-y-4">
            {campaigns.length === 0 && (
              <div className="py-12 text-center text-[#5f6b7e] font-bold">لا توجد حملات مسجلة بعد. ابدأ بإنشاء مسودة حملة جديدة.</div>
            )}

            {campaigns.map(campaign => (
              <div key={campaign.id} className="rounded-2xl border border-[#222a36] bg-[#0d1117] p-5 hover:shadow-md transition-shadow">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-3">
                      <span className="font-bold text-white text-base">{campaign.name}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${STATUS_STYLES[campaign.status]}`}>
                        {STATUS_ARABIC[campaign.status] ?? campaign.status}
                      </span>
                      <span className="bg-[#0b0e14] text-[#8b95a7] text-[10px] font-bold px-2 py-1 rounded-md">
                        {TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type}
                      </span>
                    </div>

                    <div className="flex gap-6 text-sm text-[#8b95a7] flex-wrap font-medium">
                      <div className="flex items-center gap-1.5"><Target size={14} className="text-[#5f6b7e]"/> المستهدفين: {campaign.target_count}</div>
                      <div className="flex items-center gap-1.5"><Megaphone size={14} className="text-blue-400"/> أُرسلت: {campaign.sent_count}</div>
                      <div className="flex items-center gap-1.5"><MessageSquare size={14} className="text-purple-400"/> الردود: {(campaign as any).response_count}</div>
                      <div className="flex items-center gap-1.5"><Activity size={14} className="text-amber-400"/> الدفعات: {campaign.payment_count}</div>
                      <div className="flex items-center gap-1.5 text-emerald-600 font-bold">المحصّل: {String(Number(campaign.total_collected ?? 0))} SAR</div>
                    </div>
                  </div>

                  {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
                    <button
                      onClick={() => handleRunCampaign(campaign)}
                      disabled={runningCampaignId === campaign.id}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 shrink-0">
                      <PlayCircle size={14} />
                      {runningCampaignId === campaign.id ? 'جارٍ التشغيل…' : 'تشغيل الحملة'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm border-t border-[#222a36] pt-6">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-center">
            <div className="text-emerald-600/80 font-bold text-xs mb-1">إجمالي المبالغ المحصلة (من الحملات)</div>
            <div className="font-bold text-emerald-600 text-xl font-mono">{String(totalCollected)} SAR</div>
          </div>
          <div className="rounded-xl border border-[#222a36] bg-[#0d1117] p-4 text-center">
            <div className="text-[#8b95a7] font-bold text-xs mb-1">حالة المعالجة في الخلفية</div>
            <div className="font-bold text-white">جاهز لإدارة الطوابير</div>
          </div>
          <div className="rounded-xl border border-[#222a36] bg-[#0d1117] p-4 text-center">
            <div className="text-[#8b95a7] font-bold text-xs mb-1">استقرار خوادم الإرسال</div>
            <div className="font-bold text-white flex items-center justify-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> مستقر 100%</div>
          </div>
        </div>
      </div>

      {/* QR Code Modal for linking */}
      {activeQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0e7a54]/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#151a23] border border-[#222a36] rounded-3xl w-full max-w-sm shadow-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-2">
              <QrCode size={32} />
            </div>
            <h2 className="font-bold text-white text-xl">مسح الباركود لربط الواتساب</h2>
            <p className="text-[#8b95a7] text-sm leading-relaxed">افتح تطبيق الواتساب في هاتفك، اذهب إلى "الأجهزة المرتبطة"، وقم بمسح هذا الرمز.</p>

            <div className="w-64 h-64 mx-auto flex items-center justify-center border-2 border-dashed border-[#222a36] rounded-2xl bg-[#151a23] overflow-hidden p-2">
              {qrLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-4 border-[#0e7a54] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[#5f6b7e] text-sm font-bold">جاري توليد الباركود...</span>
                </div>
              ) : activeQr.qrCode ? (
                <img
                  src={activeQr.qrCode.startsWith('data:') ? activeQr.qrCode : `data:image/png;base64,${activeQr.qrCode}`}
                  alt="WhatsApp Link QR"
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-[#5f6b7e] text-sm font-bold">الباركود غير متوفر</span>
              )}
            </div>

            {activeQr.pairingCode && (
              <div className="bg-[#0b0e14] rounded-xl p-3 text-sm">
                <span className="text-[#8b95a7] font-bold">أو أدخل كود الربط: </span>
                <span className="font-mono font-bold text-lg tracking-widest text-white block mt-1">{activeQr.pairingCode}</span>
              </div>
            )}

            <div className="text-sm text-emerald-600 font-bold flex items-center justify-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              في انتظار استجابة هاتفك...
            </div>

            <button
              onClick={() => setActiveQr(null)}
              className="w-full bg-[#151a23] border border-[#222a36] hover:bg-[#1a212c] text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors"
            >
              إلغاء وإغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
