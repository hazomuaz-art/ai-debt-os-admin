'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Campaign } from '@/types'
import { useLocale } from '@/lib/i18n'

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
  draft: 'bg-slate-50 text-slate-500 border-slate-200',
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  running: 'bg-green-500/10 text-green-400 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  completed: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const TYPE_LABELS: Record<string, string> = {
  overdue_90: 'Overdue 90',
  pre_salary: 'Pre Salary',
  post_holiday: 'Post Holiday',
  settlement: 'Settlement',
  reminder: 'Reminder',
  custom: 'Custom',
}

export default function CampaignsPage() {
  const { t, isRTL, locale } = useLocale()
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
  })

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
          alert('WhatsApp Connected Successfully!')
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
        alert('Failed to generate QR Code. Please check Evolution API integration settings.')
        setActiveQr(null)
      }
    } catch (e) {
      alert('Failed to connect')
      setActiveQr(null)
    } finally {
      setQrLoading(false)
    }
  }

  async function handleDisconnect(numberId: string) {
    if (!confirm('Are you sure you want to disconnect this WhatsApp number?')) return
    setConnectionStates(prev => ({ ...prev, [numberId]: 'loading' }))
    try {
      const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${numberId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setConnectionStates(prev => ({ ...prev, [numberId]: 'close' }))
        await load()
      } else {
        alert('Failed to disconnect')
        void fetchConnectionStatuses(numbers)
      }
    } catch (e) {
      alert('Failed to disconnect')
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
        body: JSON.stringify({ ...campaignForm, status: 'draft', channels: ['whatsapp'] }),
      })
      setCampaignForm({ name: '', campaign_type: 'reminder', message_template: '' })
      setShowCampaignForm(false)
      await load()
    } finally {
      setSaving(false)
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
          provider: 'evolution',
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
    <div className="space-y-6" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {locale === 'ar' ? 'محرك الحملات' : 'Campaign Engine'}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {locale === 'ar'
              ? 'إدارة حملات التحصيل، أرقام الواتساب للمشاريع، الطاقة اليومية، وجاهزية صف الانتظار.'
              : 'Manage collection campaigns, project WhatsApp numbers, daily capacity, and queue readiness.'}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowNumberForm(p => !p)} className="btn-secondary text-sm">
            {showNumberForm 
              ? (locale === 'ar' ? 'إلغاء الرقم' : 'Cancel Number') 
              : (locale === 'ar' ? 'ربط رقم واتساب +' : '+ WhatsApp Number')}
          </button>
          <button onClick={() => setShowCampaignForm(p => !p)} className="btn-primary text-sm">
            {showCampaignForm 
              ? (locale === 'ar' ? 'إلغاء الحملة' : 'Cancel Campaign') 
              : (locale === 'ar' ? 'حملة جديدة +' : '+ New Campaign')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="text-slate-500 text-xs">{t.nav.campaigns}</div>
          <div className="font-display text-2xl font-bold">{campaigns.length}</div>
        </div>
        <div className="stat-card">
          <div className="text-slate-500 text-xs">
            {locale === 'ar' ? 'نشطة جارية' : 'Running'}
          </div>
          <div className="font-display text-2xl font-bold text-green-500">{runningCampaigns}</div>
        </div>
        <div className="stat-card">
          <div className="text-slate-500 text-xs">{t.nav.whatsapp}</div>
          <div className="font-display text-2xl font-bold">{activeNumbers}</div>
        </div>
        <div className="stat-card">
          <div className="text-slate-500 text-xs">
            {locale === 'ar' ? 'القدرة اليومية' : 'Daily Capacity'}
          </div>
          <div className="font-display text-2xl font-bold text-brand-500">{String(dailyCapacity)}</div>
        </div>
        <div className="stat-card">
          <div className="text-slate-500 text-xs">
            {locale === 'ar' ? 'أُرسل اليوم' : 'Sent Today'}
          </div>
          <div className="font-display text-2xl font-bold">{String(sentToday)}</div>
        </div>
      </div>

      {showNumberForm && (
        <form onSubmit={handleAddNumber} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm">Link WhatsApp Number to Project</div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Project / Portfolio *</label>
              <select
                required
                className="input text-sm"
                value={numberForm.portfolio_id}
                onChange={e => setNumberForm(p => ({ ...p, portfolio_id: e.target.value }))}
              >
                <option value="">Select project</option>
                {portfolios.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} - ` : ''}{p.name_ar || p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Display Name</label>
              <input
                className="input text-sm"
                value={numberForm.display_name}
                onChange={e => setNumberForm(p => ({ ...p, display_name: e.target.value }))}
                placeholder="STC WhatsApp"
              />
            </div>

            <div>
              <label className="label">Phone Number *</label>
              <input
                required
                className="input text-sm"
                value={numberForm.phone_number}
                onChange={e => setNumberForm(p => ({ ...p, phone_number: e.target.value }))}
                placeholder="9665XXXXXXXX"
              />
            </div>

            <div>
              <label className="label">Evolution Instance *</label>
              <input
                required
                className="input text-sm"
                value={numberForm.instance_name}
                onChange={e => setNumberForm(p => ({ ...p, instance_name: e.target.value }))}
              />
            </div>

            <div>
              <label className="label">Evolution API URL</label>
              <input
                className="input text-sm"
                value={numberForm.api_url}
                onChange={e => setNumberForm(p => ({ ...p, api_url: e.target.value }))}
              />
            </div>

            <div>
              <label className="label">Daily Limit</label>
              <input
                type="number"
                min={1}
                max={5000}
                className="input text-sm"
                value={numberForm.daily_limit}
                onChange={e => setNumberForm(p => ({ ...p, daily_limit: Number(e.target.value) }))}
              />
            </div>
          </div>

          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'Saving...' : 'Save WhatsApp Number'}
          </button>
        </form>
      )}

      {showCampaignForm && (
        <form onSubmit={handleAddCampaign} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm">New Campaign Draft</div>

          <div>
            <label className="label">Campaign Name *</label>
            <input
              required
              className="input text-sm"
              value={campaignForm.name}
              onChange={e => setCampaignForm(p => ({ ...p, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Campaign Type</label>
            <select
              className="input text-sm"
              value={campaignForm.campaign_type}
              onChange={e => setCampaignForm(p => ({ ...p, campaign_type: e.target.value }))}
            >
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Message Template</label>
            <textarea
              rows={3}
              className="input text-sm"
              placeholder="Initial WhatsApp message..."
              value={campaignForm.message_template}
              onChange={e => setCampaignForm(p => ({ ...p, message_template: e.target.value }))}
            />
          </div>

          <p className="text-slate-400 text-xs">
            Campaign will be saved as draft. Queue worker and launch approval will be enabled in the next step.
          </p>

          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'Saving...' : 'Create Draft'}
          </button>
        </form>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-display font-semibold">
                {locale === 'ar' ? 'أرقام الواتساب للمشاريع' : 'Project WhatsApp Numbers'}
              </div>
              <div className="text-slate-500 text-xs">
                {locale === 'ar'
                  ? 'يمكن لكل محفظة استخدام رقم واتساب وحد إرسال يومي خاص بها.'
                  : 'Each portfolio can use its own Evolution instance and daily limit.'}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-slate-500 text-sm py-8 text-center">{t.common.loading}</div>
          ) : numbers.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">
              {locale === 'ar' ? 'لا توجد أرقام واتساب مرتبطة بعد.' : 'No WhatsApp numbers linked yet.'}
            </div>
          ) : (
            <div className="space-y-3">
              {numbers.map(number => (
                <div key={number.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{number.display_name || number.phone_number}</div>
                      <div className="text-slate-500 text-xs mt-1">
                        {number.portfolio?.code ? `${number.portfolio.code} - ` : ''}
                        {number.portfolio?.name_ar || number.portfolio?.name || 'Portfolio'}
                      </div>
                      <div className="text-slate-400 text-xs mt-1">
                        {number.provider} / {number.instance_name}
                      </div>
                    </div>
                    <span className={`status-badge text-[10px] ${
                      connectionStates[number.id] === 'open' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                      connectionStates[number.id] === 'connecting' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                      connectionStates[number.id] === 'loading' ? 'bg-slate-100 text-slate-400 animate-pulse' :
                      'bg-red-500/10 text-red-500 border-red-500/20'
                    }`}>
                      {connectionStates[number.id] === 'open' ? t.whatsapp.connected :
                       connectionStates[number.id] === 'connecting' ? t.whatsapp.qr_pending :
                       connectionStates[number.id] === 'loading' ? (locale === 'ar' ? 'تحقق...' : 'checking') :
                       t.whatsapp.disconnected}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                    <div className="rounded-lg bg-slate-100 border border-slate-200/50 p-3">
                      <div className="text-slate-500">{t.whatsapp.daily_limit}</div>
                      <div className="font-semibold text-slate-800">{String(Number(number.daily_limit ?? 0))}</div>
                    </div>
                    <div className="rounded-lg bg-slate-100 border border-slate-200/50 p-3">
                      <div className="text-slate-500">{t.whatsapp.sent_today}</div>
                      <div className="font-semibold text-slate-800">{String(Number(number.sent_today ?? 0))}</div>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-4 justify-end border-t border-slate-200/50 pt-3">
                    {connectionStates[number.id] === 'open' ? (
                      <button
                        onClick={() => handleDisconnect(number.id)}
                        className="text-xs font-semibold text-red-600 hover:text-red-500 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition"
                      >
                        {locale === 'ar' ? 'قطع الاتصال' : 'Disconnect'}
                      </button>
                    ) : connectionStates[number.id] === 'loading' ? (
                      <span className="text-slate-400 text-xs py-1.5">
                        {locale === 'ar' ? 'جاري التحقق...' : 'Checking status...'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleConnect(number.id)}
                        className="text-xs font-semibold text-brand-600 hover:text-brand-500 bg-brand-500/10 hover:bg-brand-500/20 px-3 py-1.5 rounded-lg transition"
                      >
                        {locale === 'ar' ? 'ربط الرقم' : 'Connect WhatsApp'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="font-display font-semibold mb-1">
            {locale === 'ar' ? 'بنية صف التحصيل' : 'Queue Foundation'}
          </div>
          <div className="text-slate-500 text-xs mb-4">
            {locale === 'ar'
              ? 'جداول الطوابير جاهزة. سيتم إلحاق عامل الطابور لاحقاً لجدولة الرسائل للمستلمين بأمان.'
              : 'Queue tables are ready. Worker will be added next to schedule and send recipients safely.'}
          </div>

          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-medium">{locale === 'ar' ? 'قواعد إيقاف التحصيل' : 'Stop Rules'}</div>
              <div className="text-slate-500 text-xs mt-1">
                {locale === 'ar'
                  ? 'الإيقاف التلقائي عند الرد، طلب دفع، اعتراض، وعد نشط، أو طلب تقسيط.'
                  : 'Stop on reply, payment claim, dispute, open promise, or installment request.'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-medium">{locale === 'ar' ? 'تنظيم التدفق اليومي' : 'Daily Throttling'}</div>
              <div className="text-slate-500 text-xs mt-1">
                {locale === 'ar'
                  ? 'كل رقم واتساب له حد إرسال يومي ومدة تأخير زمنية خاصة لمنع الحظر.'
                  : 'Each WhatsApp number has its own daily limit and send delay window.'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-medium">{locale === 'ar' ? 'عزل المحافظ للمشاريع' : 'Portfolio Isolation'}</div>
              <div className="text-slate-500 text-xs mt-1">
                {locale === 'ar'
                  ? 'فصل مشاريع الاتصالات (STC، موبايلي، زين)، التأمين، والخدمات الحكومية بمحافظ مستقلة.'
                  : 'STC, Mobily, Zain, insurance, utility projects can be separated by portfolio.'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-display font-semibold">
              {t.nav.campaigns}
            </div>
            <div className="text-slate-500 text-xs">
              {locale === 'ar' ? 'المسودات، الحملات المجدولة، ونتائج التحصيل.' : 'Drafts, scheduled campaigns, and collection results.'}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-500 py-12">{t.common.loading}</div>
        ) : (
          <div className="space-y-3">
            {campaigns.length === 0 && (
              <div className="p-10 text-center text-slate-400">
                {locale === 'ar' ? 'لا توجد حملات بعد.' : 'No campaigns yet.'}
              </div>
            )}

            {campaigns.map(campaign => (
              <div key={campaign.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium">{campaign.name}</span>
                      <span className={`status-badge text-[10px] ${STATUS_STYLES[campaign.status]}`}>
                        {campaign.status}
                      </span>
                      <span className="bg-slate-50 text-slate-500 text-[10px] px-1.5 py-0.5 rounded border border-slate-200">
                        {TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type}
                      </span>
                    </div>

                    <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                      <span>{locale === 'ar' ? 'المستهدفين:' : 'Targets:'} {campaign.target_count}</span>
                      <span>{locale === 'ar' ? 'المرسلة:' : 'Sent:'} {campaign.sent_count}</span>
                      <span>{locale === 'ar' ? 'الردود:' : 'Replies:'} {campaign.response_count}</span>
                      <span>{locale === 'ar' ? 'الدفعات:' : 'Payments:'} {campaign.payment_count}</span>
                      <span>{locale === 'ar' ? 'المحصل:' : 'Collected:'} {String(Number(campaign.total_collected ?? 0))} SAR</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="text-slate-500">{locale === 'ar' ? 'إجمالي المحصل' : 'Total Collected'}</div>
            <div className="font-display text-lg font-bold text-brand-600">
              {String(totalCollected)} SAR
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="text-slate-500">{locale === 'ar' ? 'الخطوة التالية' : 'Next Step'}</div>
            <div className="font-semibold text-slate-800">{locale === 'ar' ? 'منظم صفوف الإرسال' : 'Queue Worker'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-100 p-4">
            <div className="text-slate-500">{t.debts.status}</div>
            <div className="font-semibold text-brand-600">{locale === 'ar' ? 'جاهزية النظام' : 'Backend Ready'}</div>
          </div>
        </div>
      </div>
      {/* QR Code Modal for linking */}
      {activeQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center space-y-4">
            <h2 className="font-display font-semibold text-lg">Scan QR Code to Link WhatsApp</h2>
            <p className="text-slate-500 text-xs">Open WhatsApp on your phone, go to Linked Devices, and scan the code below.</p>

            <div className="w-64 h-64 mx-auto flex items-center justify-center border border-slate-200 rounded-xl bg-slate-50 shadow-inner overflow-hidden">
              {qrLoading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-slate-400 text-xs">Generating QR Code...</span>
                </div>
              ) : activeQr.qrCode ? (
                <img
                  src={activeQr.qrCode.startsWith('data:') ? activeQr.qrCode : `data:image/png;base64,${activeQr.qrCode}`}
                  alt="WhatsApp Link QR"
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <span className="text-slate-400 text-xs">No QR Code available</span>
              )}
            </div>

            {activeQr.pairingCode && (
              <div className="bg-slate-100 rounded-lg p-2.5 text-xs">
                <span className="text-slate-500 font-medium">Or enter Pairing Code: </span>
                <span className="font-mono font-bold text-sm tracking-widest text-brand-600">{activeQr.pairingCode}</span>
              </div>
            )}

            <div className="text-xs text-brand-500 font-medium flex items-center justify-center gap-1.5 animate-pulse">
              <span className="w-1.5 h-1.5 bg-brand-500 rounded-full" />
              Waiting for scanning...
            </div>

            <button
              onClick={() => setActiveQr(null)}
              className="btn-secondary w-full text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

