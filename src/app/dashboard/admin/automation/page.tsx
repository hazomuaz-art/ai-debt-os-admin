'use client'

import { useState, useEffect } from 'react'
import type { SystemConfig } from '@/types'

const MODE_CONFIG = {
  off:  { label: 'OFF',  desc: 'النظام يعرض التحليلات فقط — لا إرسال، لا اتصال تلقائي',  color: 'bg-white/5 text-white/50 border-white/10',  dot: 'bg-white/30' },
  test: { label: 'TEST', desc: 'تجربة داخلية — يسجّل ما كان سيحدث بدون إرسال فعلي',       color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', dot: 'bg-yellow-400' },
  live: { label: 'LIVE', desc: 'التشغيل الحقيقي — WhatsApp + AI + Calls + Campaigns',    color: 'bg-green-500/10 text-green-400 border-green-500/20',  dot: 'bg-green-400 animate-pulse' },
} as const

const MODULE_LABELS: Record<string, string> = {
  smart_rules:         'Smart Rules Engine',
  ai_memory:           'AI Memory',
  behavior_profiles:   'Customer Behavior Profiles',
  negotiation_engine:  'Negotiation Engine',
  voice_collector:     'AI Voice Collector',
  omnichannel_timeline:'Omnichannel Timeline',
  campaign_engine:     'Campaign Engine',
  approval_system:     'Approval System',
  promise_tracker:     'Promise-to-Pay Tracker',
  knowledge_base:      'Knowledge Base',
  human_handoff:       'Human Handoff',
  queue_priority:      'Queue Priority',
}

export default function AutomationPage() {
  const [config, setConfig] = useState<Partial<SystemConfig>>({ automation_mode: 'off' })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [confirmLive, setConfirmLive] = useState(false)

  useEffect(() => {
    fetch('/api/modules/config')
      .then(r => r.json())
      .then((d: { data?: SystemConfig }) => { if (d.data) setConfig(d.data) })
      .catch(() => {})
  }, [])

  async function save(updates: Partial<SystemConfig>) {
    setSaving(true)
    const next = { ...config, ...updates }
    setConfig(next)
    try {
      await fetch('/api/modules/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  function setMode(mode: 'off' | 'test' | 'live') {
    if (mode === 'live' && !confirmLive) { setConfirmLive(true); return }
    setConfirmLive(false)
    void save({ automation_mode: mode })
  }

  function toggleModule(key: string, val: boolean) {
    const modules = { ...(config.modules ?? {}) as Record<string, boolean>, [key]: val }
    void save({ modules })
  }

  function toggleEmergency(key: keyof SystemConfig) {
    void save({ [key]: !config[key] })
  }

  const mode = (config.automation_mode ?? 'off') as 'off' | 'test' | 'live'
  const mc   = MODE_CONFIG[mode]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Automation Control</h1>
          <p className="text-white/40 text-sm mt-0.5">التحكم في وضع التشغيل والموديولات</p>
        </div>
        {saving && <span className="text-white/30 text-xs mt-2">جارٍ الحفظ…</span>}
        {saved  && <span className="text-green-400 text-xs mt-2">✓ تم الحفظ</span>}
      </div>

      {/* Mode selector */}
      <div className="card p-5 space-y-4">
        <div className="font-display font-semibold text-sm">وضع التشغيل الحالي</div>
        <div className="grid grid-cols-3 gap-3">
          {(['off','test','live'] as const).map(m => {
            const mc2 = MODE_CONFIG[m]
            const isActive = mode === m
            return (
              <button key={m}
                onClick={() => setMode(m)}
                className={`p-4 rounded-xl border text-left transition-all ${isActive ? mc2.color : 'bg-white/3 border-white/5 text-white/30 hover:text-white/60 hover:bg-white/5'}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${isActive ? mc2.dot : 'bg-white/20'}`} />
                  <span className="font-display font-bold text-sm">{mc2.label}</span>
                </div>
                <p className="text-xs leading-relaxed opacity-70">{mc2.desc}</p>
              </button>
            )
          })}
        </div>

        {/* Live confirmation */}
        {confirmLive && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 space-y-3">
            <div className="text-green-400 font-semibold text-sm">⚠ تأكيد تفعيل LIVE Mode</div>
            <p className="text-white/60 text-xs">سيبدأ النظام بإرسال رسائل WhatsApp وإجراء اتصالات AI فعلية. تأكد من ضبط الحدود اليومية أولاً.</p>
            <div className="flex gap-3">
              <button onClick={() => { setConfirmLive(false); void save({ automation_mode: 'live' }) }}
                className="btn-primary text-sm px-4 py-1.5">نعم، فعّل LIVE</button>
              <button onClick={() => setConfirmLive(false)}
                className="btn-secondary text-sm px-4 py-1.5">إلغاء</button>
            </div>
          </div>
        )}
      </div>

      {/* Emergency stops */}
      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4 text-red-400">🛑 Emergency Stop Controls</div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'emergency_stop_all' as const,      label: 'إيقاف كل شيء' },
            { key: 'emergency_stop_ai' as const,       label: 'إيقاف AI فقط' },
            { key: 'emergency_stop_whatsapp' as const, label: 'إيقاف WhatsApp' },
            { key: 'emergency_stop_calls' as const,    label: 'إيقاف المكالمات' },
          ].map(({ key, label }) => (
            <button key={key}
              onClick={() => toggleEmergency(key)}
              className={`p-3 rounded-lg border text-sm font-medium transition-colors ${
                config[key]
                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'bg-white/3 text-white/40 border-white/10 hover:text-white/70'
              }`}
            >
              {config[key] ? '🔴 ' : '⚪ '}{label}
            </button>
          ))}
        </div>
      </div>

      {/* Usage limits */}
      <div className="card p-5 space-y-4">
        <div className="font-display font-semibold text-sm">Usage Limits (Cost Shield)</div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'daily_ai_calls_limit' as const,      label: 'حد AI calls / يوم' },
            { key: 'daily_whatsapp_limit' as const,      label: 'حد WhatsApp / يوم' },
            { key: 'daily_call_analysis_limit' as const, label: 'حد تحليل مكالمات / يوم' },
            { key: 'monthly_cost_limit' as const,        label: 'حد التكلفة الشهرية ($)' },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input type="number" min="0" className="input text-sm w-full"
                value={String(config[key] ?? '')}
                onChange={e => setConfig(p => ({ ...p, [key]: Number(e.target.value) }))}
                onBlur={() => void save({})}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Module toggles */}
      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4">Module Toggles</div>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(MODULE_LABELS).map(([key, label]) => {
            const enabled = !!(config.modules as Record<string,boolean> | undefined)?.[key]
            return (
              <button key={key}
                onClick={() => toggleModule(key, !enabled)}
                className={`flex items-center justify-between p-3 rounded-lg border text-sm transition-colors ${
                  enabled
                    ? 'bg-brand-600/10 border-brand-500/20 text-white'
                    : 'bg-white/3 border-white/5 text-white/40'
                }`}
              >
                <span className="truncate">{label}</span>
                <span className={`ml-2 shrink-0 text-xs px-1.5 py-0.5 rounded ${enabled ? 'bg-brand-500/20 text-brand-400' : 'bg-white/5 text-white/20'}`}>
                  {enabled ? 'ON' : 'OFF'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
