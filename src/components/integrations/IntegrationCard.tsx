'use client'

import { useState, useTransition } from 'react'
import type { IntegrationSetting } from '@/types'

// ── Field definitions per integration ──

interface FieldDef {
  key:         string
  label:       string
  placeholder: string
  type?:       'text' | 'password' | 'url'
  hint?:       string
}

const FIELD_DEFS: Record<string, FieldDef[]> = {
  waha: [
    { key: 'api_url', label: 'رابط الخادم (WAHA URL)', type: 'url', placeholder: 'https://waha.yourdomain.com' },
    { key: 'api_key', label: 'مفتاح الـ API', type: 'password', placeholder: 'WAHA API Key' },
    { key: 'session', label: 'اسم الجلسة (Session)', type: 'text', placeholder: 'default' },
  ],
  n8n_automation: [
    { key: 'webhook_url', label: 'رابط ويب هوك (n8n Webhook URL)', type: 'url', placeholder: 'https://n8n.yourdomain.com/webhook/...' },
    { key: 'auth_token', label: 'رمز التوثيق (Auth Token)', type: 'password', placeholder: 'Secret token used in header' },
  ],
  collection_api: [
    { key: 'base_url',  label: 'رابط واجهة برمجة تطبيقات التحصيل', type: 'url',      placeholder: 'https://api.collectionsystem.io' },
    { key: 'username',  label: 'اسم المستخدم',     type: 'text',     placeholder: 'Service account username' },
    { key: 'token',     label: 'كلمة المرور / الرمز', type: 'password', placeholder: 'Password or API token' },
  ],
}

// ── Status badge ──

function StatusBadge({ enabled, lastError }: { enabled: boolean; lastError: string | null }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#222a36] text-[#8b95a7] border border-[#222a36]">
        غير مفعل
      </span>
    )
  }
  if (lastError) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200">
        يوجد خطأ
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
      متصل
    </span>
  )
}

// ── Toggle ──

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-[#0e7a54] border-[#0e7a54]' : 'bg-slate-200 border-[#222a36]',
      ].join(' ')}
      dir="ltr"
    >
      <span
        className={[
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-[#151a23] shadow-sm',
          'transition-transform duration-200 transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

// ── Main component ──

interface IntegrationCardProps {
  name:         string
  label:        string
  description:  string
  icon:         React.ReactNode
  integrationKey: string
  initial?:     IntegrationSetting | null
}

export function IntegrationCard({
  name,
  label,
  description,
  icon,
  integrationKey,
  initial,
}: IntegrationCardProps) {
  const fields = FIELD_DEFS[integrationKey] ?? []

  const [enabled,   setEnabled]   = useState(initial?.enabled ?? false)
  const [config,    setConfig]    = useState<Record<string, string>>(
    (initial?.config as Record<string, string>) ?? {}
  )
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testMsg,   setTestMsg]   = useState('')
  const [lastError, setLastError] = useState<string | null>(initial?.last_error ?? null)
  const [lastSynced, setLastSynced] = useState<string | null>(initial?.last_synced_at ?? null)

  const isConfigured = fields.every(f => !!(config[f.key]?.trim()))

  function handleField(key: string, value: string) {
    setConfig(prev => ({ ...prev, [key]: value }))
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function handleSave() {
    setSaveState('saving')
    try {
      const res = await fetch('/api/integrations', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ integration_name: integrationKey, enabled, config }),
      })
      const data = await res.json() as { data?: unknown; error?: string }
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (err) {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  async function handleTest() {
    setTestState('testing')
    setTestMsg('')
    try {
      const res = await fetch('/api/integrations/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ integration_name: integrationKey, config }),
      })
      const data = await res.json() as { success: boolean; message: string; latency_ms?: number }
      if (data.success) {
        setTestState('ok')
        setTestMsg('تم الاتصال بنجاح')
        setLastError(null)
      } else {
        setTestState('fail')
        setTestMsg('فشل الاتصال: ' + data.message)
        setLastError(data.message)
      }
    } catch (err) {
      setTestState('fail')
      setTestMsg('فشل الاتصال بالخادم')
    } finally {
      setTimeout(() => { setTestState('idle'); setTestMsg('') }, 6000)
    }
  }

  return (
    <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-50 bg-[#0d1117]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="font-bold text-white text-lg">{label}</h3>
              <StatusBadge enabled={enabled} lastError={lastError} />
            </div>
            <p className="text-[#8b95a7] text-sm">{description}</p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} />
      </div>

      {/* Fields */}
      <div className="p-6 space-y-5 flex-1">
        {fields.map(field => (
          <div key={field.key}>
            <label className="block text-sm font-bold text-white mb-2">
              {field.label}
              {field.hint && <span className="text-[#5f6b7e] font-normal me-2">— {field.hint}</span>}
            </label>
            <input
              type={field.type ?? 'text'}
              value={config[field.key] ?? ''}
              onChange={e => handleField(field.key, e.target.value)}
              placeholder={field.placeholder}
              autoComplete={field.type === 'password' ? 'new-password' : 'off'}
              className="w-full bg-[#0d1117] border border-[#222a36] text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-[#0e7a54] focus:ring-1 focus:ring-[#0e7a54] transition-colors font-mono"
              dir="ltr"
            />
          </div>
        ))}

        {/* Test result message */}
        {testMsg && (
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${testState === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {testMsg}
          </div>
        )}
      </div>
      
      {/* Footer Actions */}
      <div className="p-6 bg-[#222a36] border-t border-[#222a36] flex items-center justify-between">
        <button
          type="button"
          onClick={handleTest}
          disabled={testState === 'testing' || !isConfigured}
          className="px-4 py-2 text-white bg-[#151a23] border border-[#222a36] hover:bg-[#1a212c] font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
        >
          {testState === 'testing' ? 'جاري الفحص...' : 'فحص الاتصال'}
        </button>
        
        <button
          type="button"
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className="px-6 py-2 bg-[#0e7a54] hover:bg-[#152e3b] text-white font-bold rounded-xl text-sm transition-colors"
        >
          {saveState === 'saving'  ? 'جاري الحفظ...' :
           saveState === 'saved'   ? 'تم الحفظ ✔'   :
           saveState === 'error'   ? 'فشل الحفظ ✖'  : 'حفظ الإعدادات'}
        </button>
      </div>
    </div>
  )
}
