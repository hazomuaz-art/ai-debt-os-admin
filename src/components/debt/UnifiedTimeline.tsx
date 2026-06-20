import {
  MessageSquare, Wallet, ShieldAlert, Target, FileText, History, BellRing, CheckCircle,
} from 'lucide-react'

// A single chronological log that merges every event tied to a customer's
// file — inbound/outbound messages, payments, promises, disputes, status
// changes and collector follow-ups — so an agent (human or AI reviewer)
// can read the whole story top-to-bottom instead of hunting across cards.

type AnyRow = Record<string, any>

export interface UnifiedTimelineProps {
  messages?: AnyRow[]
  payments?: AnyRow[]
  promises?: AnyRow[]
  approvals?: AnyRow[]
  followups?: AnyRow[]
  statusHistory?: AnyRow[]
  currency?: string
}

type Item = {
  at: number
  kind: 'msg_in' | 'msg_out' | 'payment' | 'promise' | 'dispute' | 'followup' | 'status'
  title: string
  body?: string
  meta?: string
}

const KIND_STYLE: Record<Item['kind'], { icon: any; color: string; label: string }> = {
  msg_in:   { icon: MessageSquare, color: '#60a5fa', label: 'رسالة من العميل' },
  msg_out:  { icon: MessageSquare, color: '#34d399', label: 'رد الوكيل' },
  payment:  { icon: Wallet,        color: '#34d399', label: 'سداد' },
  promise:  { icon: Target,        color: '#fbbf24', label: 'وعد سداد' },
  dispute:  { icon: ShieldAlert,   color: '#f87171', label: 'اعتراض' },
  followup: { icon: FileText,      color: '#a78bfa', label: 'متابعة' },
  status:   { icon: History,       color: '#8b95a7', label: 'تغيير حالة' },
}

function ts(d: any): number {
  const t = new Date(String(d ?? '')).getTime()
  return Number.isNaN(t) ? 0 : t
}

export default function UnifiedTimeline(props: UnifiedTimelineProps) {
  const cur = props.currency || 'SAR'
  const items: Item[] = []

  for (const m of props.messages ?? []) {
    const out = m.direction === 'outbound'
    items.push({
      at: ts(m.sent_at || m.created_at),
      kind: out ? 'msg_out' : 'msg_in',
      title: out ? (m.metadata?.sender === 'ai' ? 'رد الوكيل (AI)' : 'رسالة صادرة') : 'رسالة من العميل',
      body: m.content,
      meta: [m.status, m.metadata?.action_type].filter(Boolean).join(' · '),
    })
  }
  for (const p of props.payments ?? []) {
    items.push({
      at: ts(p.payment_date || p.created_at),
      kind: 'payment',
      title: `سداد ${Number(p.amount).toLocaleString('en-US')} ${p.currency || cur}`,
      meta: [p.verification_status === 'verified' ? 'مؤكد' : 'بانتظار التحقق', p.notes].filter(Boolean).join(' · '),
    })
  }
  for (const pr of props.promises ?? []) {
    const st = { pending: 'قائم', kept: 'تم الوفاء', broken: 'مُخلَف', rescheduled: 'أُعيد جدولته', partial: 'جزئي' }[String(pr.status)] ?? pr.status
    items.push({
      at: ts(pr.created_at),
      kind: 'promise',
      title: `وعد سداد ${pr.promised_amount ? Number(pr.promised_amount).toLocaleString('en-US') + ' ' + cur : ''} (${st})`,
      body: pr.promised_date ? `الموعد: ${String(pr.promised_date).slice(0, 10)}` : undefined,
      meta: pr.notes,
    })
  }
  for (const a of props.approvals ?? []) {
    if (a.approval_type !== 'dispute') continue
    items.push({
      at: ts(a.created_at),
      kind: 'dispute',
      title: `اعتراض (${a.status})`,
      body: a.description || a.reason,
    })
  }
  for (const f of props.followups ?? []) {
    items.push({
      at: ts(f.occurred_at),
      kind: 'followup',
      title: f.normalized_status || 'متابعة',
      body: [f.customer_statement && `إفادة العميل: ${f.customer_statement}`, f.collector_note && `ملاحظة المحصّل: ${f.collector_note}`, f.result_summary].filter(Boolean).join('\n'),
      meta: f.collector_name,
    })
  }
  for (const s of props.statusHistory ?? []) {
    items.push({
      at: ts(s.changed_at),
      kind: 'status',
      title: `الحالة: ${s.old_status ?? '—'} ← ${s.new_status ?? s.normalized_status ?? '—'}`,
      meta: s.changed_by_name,
    })
  }

  items.sort((a, b) => b.at - a.at)

  return (
    <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
      <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-5">
        <History className="text-white" size={20} />
        <h2 className="text-lg font-bold text-white">السجل الكامل للعميل</h2>
        <span className="text-[#5f6b7e] text-xs">({items.length} حدث)</span>
      </div>

      {items.length === 0 ? (
        <p className="text-[#5f6b7e] text-sm text-center py-6">لا توجد أحداث مسجلة بعد.</p>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto pe-2">
          {items.map((it, i) => {
            const s = KIND_STYLE[it.kind]
            const Icon = s.icon
            return (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: `${s.color}1a`, color: s.color }}>
                    <Icon size={15} />
                  </div>
                  {i < items.length - 1 && <div className="w-px flex-1 bg-[#222a36] my-1" />}
                </div>
                <div className="flex-1 pb-3 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold" style={{ color: s.color }}>{it.title}</span>
                    <span className="text-[10px] text-[#5f6b7e] shrink-0 font-mono" dir="ltr">
                      {it.at ? new Date(it.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    </span>
                  </div>
                  {it.body && <p className="text-[#c5ccd6] text-sm mt-0.5 whitespace-pre-wrap break-words">{it.body}</p>}
                  {it.meta && <p className="text-[#5f6b7e] text-xs mt-0.5">{it.meta}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
