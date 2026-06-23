'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ShieldCheck, Landmark, Plus, Power, AlertTriangle, FileText, Bot, Ban, Scale, ListChecks } from 'lucide-react'

type EscalationRule = { keywords: string[]; reason: string }

type Playbook = {
  portfolio_id: string
  category: string
  discounts: { allowed: boolean; max_percent: number; requires_admin_approval: boolean }
  installments: { allowed: boolean; max_months: number; requires_admin_approval: boolean }
  fields_to_surface: string[]
  allowed_dispute_types: string[]
  notes: string | null
  company_policy: string | null
  ai_instructions: string | null
  forbidden_phrases: string[]
  escalation_rules: EscalationRule[]
  portfolio_specific_rules: string | null
  is_default: boolean
}

// "كلمة1, كلمة2 => سبب التصعيد" — سطر واحد لكل قاعدة، تحويل بسيط بلا تعقيد JSON يدوي.
function escalationRulesToText(rules: EscalationRule[]): string {
  return rules.map(r => `${r.keywords.join(', ')} => ${r.reason}`).join('\n')
}
function textToEscalationRules(text: string): EscalationRule[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [kwPart, ...rest] = line.split('=>')
    return {
      keywords: kwPart.split(',').map(k => k.trim()).filter(Boolean),
      reason: rest.join('=>').trim() || 'تصعيد إلزامي بسياسة المحفظة',
    }
  }).filter(r => r.keywords.length > 0)
}

type CollectionAccount = {
  id: string
  portfolio_id: string | null
  method_type: 'iban' | 'sadad_biller'
  iban: string | null
  account_name: string | null
  bank_name: string | null
  biller_code: string | null
  biller_name: string | null
  instructions: string | null
  is_active: boolean
}

const FIELD_OPTIONS_BY_CATEGORY: Record<string, string[]> = {
  telecom: ['account_number', 'product_number', 'sadad_number', 'invoice_dispute', 'statement_request'],
  insurance: ['recovery_number', 'recourse_reason', 'fault_percentage', 'third_party', 'recovered_deduction'],
  utility: ['account_number', 'meter_or_subscriber_number', 'payment_proof', 'invoice_dispute'],
}
const DISPUTE_OPTIONS_BY_CATEGORY: Record<string, string[]> = {
  telecom: ['wrong_number', 'not_mine', 'wrong_amount', 'already_settled', 'invoice_dispute'],
  insurance: ['recourse', 'third_party', 'recovered_deduction', 'wrong_number', 'not_mine', 'already_settled'],
  utility: ['wrong_number', 'not_mine', 'wrong_amount', 'already_settled', 'invoice_dispute'],
}

export default function PortfolioPlaybookPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [portfolio, setPortfolio] = useState<{ id: string; name_ar?: string; name: string; category: string } | null>(null)
  const [playbook, setPlaybook] = useState<Playbook | null>(null)
  const [accounts, setAccounts] = useState<CollectionAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newAccount, setNewAccount] = useState({ method_type: 'iban' as const, iban: '', account_name: '', bank_name: '', biller_code: '', biller_name: '', instructions: '' })
  const [forbiddenText, setForbiddenText] = useState('')
  const [escalationText, setEscalationText] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [pRes, pbRes, accRes] = await Promise.all([
        fetch('/api/portfolios'),
        fetch(`/api/portfolios/${params.id}/playbook`),
        fetch(`/api/collection-accounts?portfolio_id=${params.id}`),
      ])
      const pData = await pRes.json().catch(() => ({})) as { data?: any[]; error?: string }
      const pbData = await pbRes.json().catch(() => ({})) as { data?: Playbook; error?: string }
      const accData = await accRes.json().catch(() => ({})) as { data?: CollectionAccount[]; error?: string }
      if (!pbRes.ok) throw new Error(pbData.error ?? `فشل تحميل السياسة (HTTP ${pbRes.status})`)
      setPortfolio((pData.data ?? []).find(p => p.id === params.id) ?? null)
      setPlaybook(pbData.data ?? null)
      setForbiddenText((pbData.data?.forbidden_phrases ?? []).join('\n'))
      setEscalationText(escalationRulesToText(pbData.data?.escalation_rules ?? []))
      setAccounts(Array.isArray(accData.data) ? accData.data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل بيانات المحفظة')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { void load() }, [load])

  async function savePlaybook() {
    if (!playbook) return
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/portfolios/${params.id}/playbook`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discounts: playbook.discounts,
          installments: playbook.installments,
          fields_to_surface: playbook.fields_to_surface,
          allowed_dispute_types: playbook.allowed_dispute_types,
          notes: playbook.notes,
          company_policy: playbook.company_policy,
          ai_instructions: playbook.ai_instructions,
          forbidden_phrases: forbiddenText.split('\n').map(l => l.trim()).filter(Boolean),
          escalation_rules: textToEscalationRules(escalationText),
          portfolio_specific_rules: playbook.portfolio_specific_rules,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch('/api/collection-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newAccount, portfolio_id: params.id }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setNewAccount({ method_type: 'iban', iban: '', account_name: '', bank_name: '', biller_code: '', biller_name: '', instructions: '' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function toggleAccount(id: string, current: boolean) {
    await fetch('/api/collection-accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    await load()
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]" /></div>
  }

  if (error || !playbook) {
    return (
      <div className="flex-1 px-8 pt-10 bg-[#0b0e14] min-h-screen">
        <button onClick={() => router.push('/dashboard/admin/portfolios')} className="text-[#8b95a7] hover:text-white mb-4 flex items-center gap-2">
          <ArrowRight size={18} /> رجوع للمحافظ
        </button>
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-400 font-bold">
          {error || 'تعذّر تحميل بيانات هذي المحفظة.'}
        </div>
      </div>
    )
  }

  const fieldOptions = FIELD_OPTIONS_BY_CATEGORY[playbook.category] ?? []
  const disputeOptions = DISPUTE_OPTIONS_BY_CATEGORY[playbook.category] ?? ['wrong_number', 'not_mine', 'already_settled']

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="flex items-center gap-3 mt-6">
        <button onClick={() => router.push('/dashboard/admin/portfolios')} className="text-[#8b95a7] hover:text-white p-2 rounded-lg hover:bg-[#151a23]">
          <ArrowRight size={20} />
        </button>
        <h1 className="text-2xl font-bold text-white">سياسة المحفظة: {portfolio?.name_ar || portfolio?.name}</h1>
        {playbook.is_default && (
          <span className="bg-amber-50 text-amber-600 border border-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <AlertTriangle size={14} /> لا توجد سياسة محفوظة بعد — معروضة الإعدادات الافتراضية للقطاع
          </span>
        )}
      </div>

      {error && <p className="text-rose-500 bg-rose-50 p-3 rounded-lg text-sm font-bold">{error}</p>}

      {/* Playbook policy */}
      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 space-y-5">
        <h2 className="font-bold text-white text-lg flex items-center gap-2"><ShieldCheck size={18} /> سياسة الخصومات والتقسيط</h2>
        <p className="text-[#8b95a7] text-xs">هذي سياسة فقط — أي خصم أو تقسيط فعلي يحتاج موافقة إدارة دائماً، الوكيل لا يوافق وحده تحت أي ظرف.</p>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-[#0d1117] rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-300">
              <input type="checkbox" checked={playbook.discounts.allowed}
                onChange={e => setPlaybook(p => p && ({ ...p, discounts: { ...p.discounts, allowed: e.target.checked } }))} />
              السماح بالخصم كسياسة
            </label>
            <div>
              <label className="block text-xs text-[#8b95a7] mb-1">أقصى نسبة خصم %</label>
              <input type="number" min={0} max={100} disabled={!playbook.discounts.allowed}
                className="w-full bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                value={playbook.discounts.max_percent}
                onChange={e => setPlaybook(p => p && ({ ...p, discounts: { ...p.discounts, max_percent: Number(e.target.value) } }))} />
            </div>
          </div>
          <div className="bg-[#0d1117] rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-300">
              <input type="checkbox" checked={playbook.installments.allowed}
                onChange={e => setPlaybook(p => p && ({ ...p, installments: { ...p.installments, allowed: e.target.checked } }))} />
              السماح بالتقسيط كسياسة
            </label>
            <div>
              <label className="block text-xs text-[#8b95a7] mb-1">أقصى عدد أشهر</label>
              <input type="number" min={0} max={36} disabled={!playbook.installments.allowed}
                className="w-full bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40"
                value={playbook.installments.max_months}
                onChange={e => setPlaybook(p => p && ({ ...p, installments: { ...p.installments, max_months: Number(e.target.value) } }))} />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#8b95a7] mb-2">المواضيع المسموح للوكيل الحديث عنها</label>
          <div className="flex flex-wrap gap-2">
            {fieldOptions.map(f => (
              <label key={f} className="flex items-center gap-1.5 bg-[#0d1117] px-3 py-1.5 rounded-lg text-xs text-slate-300">
                <input type="checkbox" checked={playbook.fields_to_surface.includes(f)}
                  onChange={e => setPlaybook(p => p && ({
                    ...p,
                    fields_to_surface: e.target.checked ? [...p.fields_to_surface, f] : p.fields_to_surface.filter(x => x !== f),
                  }))} />
                {f}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-[#8b95a7] mb-2">
            أنواع الاعتراض المعتمدة {playbook.category !== 'insurance' && <span className="text-amber-500">(حقول التأمين مخفية لهذا القطاع تلقائياً)</span>}
          </label>
          <div className="flex flex-wrap gap-2">
            {disputeOptions.map(d => (
              <label key={d} className="flex items-center gap-1.5 bg-[#0d1117] px-3 py-1.5 rounded-lg text-xs text-slate-300">
                <input type="checkbox" checked={playbook.allowed_dispute_types.includes(d)}
                  onChange={e => setPlaybook(p => p && ({
                    ...p,
                    allowed_dispute_types: e.target.checked ? [...p.allowed_dispute_types, d] : p.allowed_dispute_types.filter(x => x !== d),
                  }))} />
                {d}
              </label>
            ))}
          </div>
        </div>

        <button onClick={savePlaybook} disabled={saving} className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ السياسة'}
        </button>
      </div>

      {/* Real playbook policy text */}
      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 space-y-5">
        <h2 className="font-bold text-white text-lg flex items-center gap-2"><FileText size={18} /> Playbook — سياسة وتعليمات حقيقية للوكيل</h2>
        <p className="text-[#8b95a7] text-xs">هذي الحقول تُحقَن مباشرة في تعليمات الوكيل قبل كل رد. الممنوعات تُفرَض حتمياً بالكود لا بالنص فقط، وقواعد التصعيد تُضاف فوق القواعد الثابتة (محامي/قضية/شكوى/اعتراضات التأمين) ولا تستبدلها.</p>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Bot size={14} /> سياسة الشركة (Company Policy)</label>
          <textarea rows={3} className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm"
            placeholder="مثال: هذي الشركة لا تقبل أي تأجيل أكثر من 7 أيام بدون موافقة مدير التحصيل."
            value={playbook.company_policy ?? ''} onChange={e => setPlaybook(p => p && ({ ...p, company_policy: e.target.value }))} />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Bot size={14} /> تعليمات الوكيل (AI Instructions)</label>
          <textarea rows={3} className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm"
            placeholder="مثال: استخدم لقب 'حضرتك' بدل 'انت' مع عملاء هذي المحفظة."
            value={playbook.ai_instructions ?? ''} onChange={e => setPlaybook(p => p && ({ ...p, ai_instructions: e.target.value }))} />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Ban size={14} /> الممنوعات (سطر واحد لكل عبارة ممنوعة)</label>
          <textarea rows={3} className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-mono"
            placeholder={'مثال:\nبتصعيد قانوني فوري\nتقدر تسدد نص المبلغ بدون موافقة'}
            value={forbiddenText} onChange={e => setForbiddenText(e.target.value)} />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><Scale size={14} /> قواعد تصعيد إضافية (تُضاف فوق القواعد الثابتة، لا تستبدلها)</label>
          <textarea rows={3} className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-mono" dir="ltr"
            placeholder={'كلمة1, كلمة2 => سبب التصعيد\nمثال: وسيط, محامي الأسرة => العميل ذكر وسيطاً قانونياً غير معتاد'}
            value={escalationText} onChange={e => setEscalationText(e.target.value)} />
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-2"><ListChecks size={14} /> قواعد خاصة بهذي المحفظة</label>
          <textarea rows={3} className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm"
            placeholder="مثال: هذي المحفظة عملاء جدد، لا تذكر تاريخ الاستحقاق قبل التعريف الكامل."
            value={playbook.portfolio_specific_rules ?? ''} onChange={e => setPlaybook(p => p && ({ ...p, portfolio_specific_rules: e.target.value }))} />
        </div>

        <button onClick={savePlaybook} disabled={saving} className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl disabled:opacity-50">
          {saving ? 'جارٍ الحفظ…' : 'حفظ Playbook'}
        </button>
      </div>

      {/* Collection accounts */}
      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 space-y-5">
        <h2 className="font-bold text-white text-lg flex items-center gap-2"><Landmark size={18} /> حسابات السداد المعتمدة</h2>
        <p className="text-[#8b95a7] text-xs">الوكيل لا يذكر أي حساب أو آيبان للعميل إلا إذا كان موجوداً ومفعّلاً هنا. إن لم يوجد حساب، يفتح تنبيهاً تلقائياً بدل اختراع رقم.</p>

        {accounts.length === 0 && (
          <div className="bg-amber-50/10 border border-amber-500/30 rounded-xl p-4 text-amber-400 text-sm font-bold flex items-center gap-2">
            <AlertTriangle size={16} /> لا يوجد أي حساب سداد لهذي المحفظة — الوكيل سيخبر العميل أن طريقة الدفع قيد التحضير ولن يخترع رقماً.
          </div>
        )}

        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.id} className={`flex items-center justify-between bg-[#0d1117] rounded-xl p-4 ${!a.is_active ? 'opacity-50' : ''}`}>
              <div className="text-sm text-slate-300">
                {a.method_type === 'iban'
                  ? <span dir="ltr">{a.iban} — {a.account_name} ({a.bank_name})</span>
                  : <span>مفوتر {a.biller_name} — رمز {a.biller_code}</span>}
              </div>
              <button onClick={() => toggleAccount(a.id, a.is_active)} className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#151a23] text-[#8b95a7] hover:text-white">
                <Power size={14} /> {a.is_active ? 'تعطيل' : 'تفعيل'}
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addAccount} className="grid grid-cols-2 gap-3 bg-[#0d1117] rounded-xl p-4">
          <select value={newAccount.method_type} onChange={e => setNewAccount(p => ({ ...p, method_type: e.target.value as any }))}
            className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm">
            <option value="iban">آيبان (تحويل بنكي)</option>
            <option value="sadad_biller">مفوتر سداد</option>
          </select>
          {newAccount.method_type === 'iban' ? (
            <>
              <input placeholder="IBAN" dir="ltr" required value={newAccount.iban} onChange={e => setNewAccount(p => ({ ...p, iban: e.target.value }))}
                className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
              <input placeholder="اسم صاحب الحساب" value={newAccount.account_name} onChange={e => setNewAccount(p => ({ ...p, account_name: e.target.value }))}
                className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
              <input placeholder="اسم البنك" value={newAccount.bank_name} onChange={e => setNewAccount(p => ({ ...p, bank_name: e.target.value }))}
                className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
            </>
          ) : (
            <>
              <input placeholder="رمز المفوتر" required value={newAccount.biller_code} onChange={e => setNewAccount(p => ({ ...p, biller_code: e.target.value }))}
                className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
              <input placeholder="اسم المفوتر" value={newAccount.biller_name} onChange={e => setNewAccount(p => ({ ...p, biller_name: e.target.value }))}
                className="bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
            </>
          )}
          <input placeholder="تعليمات إضافية (اختياري)" value={newAccount.instructions} onChange={e => setNewAccount(p => ({ ...p, instructions: e.target.value }))}
            className="col-span-2 bg-[#151a23] border-none text-white rounded-lg px-3 py-2 text-sm" />
          <button type="submit" className="col-span-2 bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-4 py-2.5 rounded-xl flex items-center justify-center gap-2">
            <Plus size={16} /> إضافة حساب
          </button>
        </form>
      </div>
    </div>
  )
}
