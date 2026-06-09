'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Campaign } from '@/types'

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
  draft: 'bg-white/5 text-white/40 border-white/10',
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [numbers, setNumbers] = useState<PortfolioWhatsappNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [showNumberForm, setShowNumberForm] = useState(false)
  const [saving, setSaving] = useState(false)

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
    api_url: 'http://72.62.30.109:8080',
    daily_limit: 250,
  })

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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
        api_url: 'http://72.62.30.109:8080',
        daily_limit: 250,
      })
      setShowNumberForm(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Campaign Engine</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Manage collection campaigns, project WhatsApp numbers, daily capacity, and queue readiness.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowNumberForm(p => !p)} className="btn-secondary text-sm">
            {showNumberForm ? 'Cancel Number' : '+ WhatsApp Number'}
          </button>
          <button onClick={() => setShowCampaignForm(p => !p)} className="btn-primary text-sm">
            {showCampaignForm ? 'Cancel Campaign' : '+ New Campaign'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="stat-card">
          <div className="text-white/40 text-xs">Campaigns</div>
          <div className="font-display text-2xl font-bold">{campaigns.length}</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">Running</div>
          <div className="font-display text-2xl font-bold text-green-400">{runningCampaigns}</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">WhatsApp Numbers</div>
          <div className="font-display text-2xl font-bold">{activeNumbers}</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">Daily Capacity</div>
          <div className="font-display text-2xl font-bold text-brand-400">{String(dailyCapacity)}</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">Sent Today</div>
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

          <p className="text-white/30 text-xs">
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
              <div className="font-display font-semibold">Project WhatsApp Numbers</div>
              <div className="text-white/35 text-xs">Each portfolio can use its own Evolution instance and daily limit.</div>
            </div>
          </div>

          {loading ? (
            <div className="text-white/40 text-sm py-8 text-center">Loading...</div>
          ) : numbers.length === 0 ? (
            <div className="text-white/35 text-sm py-8 text-center">No WhatsApp numbers linked yet.</div>
          ) : (
            <div className="space-y-3">
              {numbers.map(number => (
                <div key={number.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">{number.display_name || number.phone_number}</div>
                      <div className="text-white/40 text-xs mt-1">
                        {number.portfolio?.code ? `${number.portfolio.code} - ` : ''}
                        {number.portfolio?.name_ar || number.portfolio?.name || 'Portfolio'}
                      </div>
                      <div className="text-white/30 text-xs mt-1">
                        {number.provider} / {number.instance_name}
                      </div>
                    </div>
                    <span className={`status-badge text-[10px] ${number.is_active ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                      {number.is_active ? 'active' : 'inactive'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-white/35">Daily Limit</div>
                      <div className="font-semibold">{String(Number(number.daily_limit ?? 0))}</div>
                    </div>
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-white/35">Sent Today</div>
                      <div className="font-semibold">{String(Number(number.sent_today ?? 0))}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="font-display font-semibold mb-1">Queue Foundation</div>
          <div className="text-white/35 text-xs mb-4">
            Queue tables are ready. Worker will be added next to schedule and send recipients safely.
          </div>

          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-medium">Stop Rules</div>
              <div className="text-white/40 text-xs mt-1">
                Stop on reply, payment claim, dispute, open promise, or installment request.
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-medium">Daily Throttling</div>
              <div className="text-white/40 text-xs mt-1">
                Each WhatsApp number has its own daily limit and send delay window.
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-medium">Portfolio Isolation</div>
              <div className="text-white/40 text-xs mt-1">
                STC, Mobily, Zain, insurance, utility projects can be separated by portfolio.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-display font-semibold">Campaigns</div>
            <div className="text-white/35 text-xs">Drafts, scheduled campaigns, and collection results.</div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-white/40 py-12">Loading...</div>
        ) : (
          <div className="space-y-3">
            {campaigns.length === 0 && (
              <div className="p-10 text-center text-white/40">No campaigns yet.</div>
            )}

            {campaigns.map(campaign => (
              <div key={campaign.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium">{campaign.name}</span>
                      <span className={`status-badge text-[10px] ${STATUS_STYLES[campaign.status]}`}>
                        {campaign.status}
                      </span>
                      <span className="bg-white/5 text-white/40 text-[10px] px-1.5 py-0.5 rounded border border-white/10">
                        {TYPE_LABELS[campaign.campaign_type] ?? campaign.campaign_type}
                      </span>
                    </div>

                    <div className="flex gap-4 text-xs text-white/40 flex-wrap">
                      <span>Targets: {campaign.target_count}</span>
                      <span>Sent: {campaign.sent_count}</span>
                      <span>Replies: {campaign.response_count}</span>
                      <span>Payments: {campaign.payment_count}</span>
                      <span>Collected: {String(Number(campaign.total_collected ?? 0))} SAR</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-white/35">Total Collected</div>
            <div className="font-display text-lg font-bold text-brand-400">
              {String(totalCollected)} SAR
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-white/35">Next Step</div>
            <div className="font-semibold">Queue Worker</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-white/35">Status</div>
            <div className="font-semibold text-yellow-400">Backend Ready</div>
          </div>
        </div>
      </div>
    </div>
  )
}

