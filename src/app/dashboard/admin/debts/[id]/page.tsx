import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import RecordPaymentModal from '@/components/debt/RecordPaymentModal'
import UpdateDebtStatusSelect from '@/components/debt/UpdateDebtStatusSelect'
import ScoreDebtButton from '@/components/ai/ScoreDebtButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import AssignDebtSelect from '@/components/debt/AssignDebtSelect'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function DebtDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: debt } = await supabase
    .from('debts')
    .select(`
      *,
      customer:customers(*),
      assigned_to_profile:profiles!debts_assigned_to_fkey(full_name, email),
      payments(*),
      messages(*),
      ai_scores(*)
    `)
    .eq('id', params.id)
    .single()

  if (!debt) notFound()

  const { data: collectors } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['collector', 'manager'])
    .order('full_name')

  const latestScore = debt.ai_scores?.sort((a: any, b: any) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]

  const { data: aiActions } = await supabase
    .from('ai_actions')
    .select('id, action_type, priority, reason, suggested_message, status, created_at')
    .eq('debt_id', debt.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: debtAlerts } = await supabase
    .from('system_alerts')
    .select('id, severity, alert_type, title, message, is_resolved, created_at')
    .eq('is_resolved', false)
    .contains('metadata', { debt_id: debt.id })
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: timelineEvents } = await supabase
    .from('timeline_events')
    .select('id, event_type, channel, summary, detail, occurred_at')
    .eq('debt_id', debt.id)
    .order('occurred_at', { ascending: false })
    .limit(8)

  const { data: promises } = await supabase
    .from('promises')
    .select('id, promised_amount, promised_date, status, channel, notes, created_at')
    .eq('debt_id', debt.id)
    .order('promised_date', { ascending: false })
    .limit(5)

  const { data: approvals } = await supabase
    .from('approvals')
    .select('id, approval_type, status, priority, reason, created_at')
    .eq('entity_id', debt.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: memoryEntries } = await supabase
    .from('ai_memory')
    .select('id, trigger_pattern, response_text, category, success_rate, use_count, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: collectionFollowups } = await supabase
    .from('collection_followups')
    .select('id, original_status, original_sub_status, normalized_status, collector_name, customer_statement, collector_note, result_summary, occurred_at')
    .eq('debt_id', debt.id)
    .order('occurred_at', { ascending: false })
    .limit(8)

  const { data: collectionStatusHistory } = await supabase
    .from('collection_status_history')
    .select('id, old_status, old_sub_status, new_status, new_sub_status, normalized_status, changed_by_name, changed_at')
    .eq('debt_id', debt.id)
    .order('changed_at', { ascending: false })
    .limit(8)

  const { data: collectionAssignments } = await supabase
    .from('collection_assignments')
    .select('id, assigned_to_name, assigned_by_name, assignment_status, assigned_at, released_at')
    .eq('debt_id', debt.id)
    .order('assigned_at', { ascending: false })
    .limit(5)

  const totalPaid = debt.payments?.reduce((sum: number, p: any) => sum + Number(p.amount), 0) ?? 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/admin/debts" className="text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-syne">{debt.reference_number}</h1>
          <p className="text-slate-400">{debt.customer?.full_name}</p>
        </div>
        <div className="ml-auto flex gap-3">
          <ScoreDebtButton debtId={debt.id} />
          <SendWhatsAppButton
            debtId={debt.id}
            phone={debt.customer?.whatsapp || debt.customer?.phone}
            customerName={debt.customer?.full_name}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Debt Overview */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Debt Overview</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-slate-400 text-sm">Original Amount</p>
                <p className="text-xl font-bold">{formatCurrency(debt.original_amount, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Current Balance</p>
                <p className="text-xl font-bold text-brand-400">{formatCurrency(debt.current_balance, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Paid</p>
                <p className="text-xl font-bold text-green-400">{formatCurrency(totalPaid, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Due Date</p>
                <p className="text-xl font-bold">{formatDate(debt.due_date)}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Status</p>
                <UpdateDebtStatusSelect debtId={debt.id} currentStatus={debt.status} />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Priority</p>
                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                  debt.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                  debt.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                  debt.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {debt.priority}
                </span>
              </div>
              {debt.description && (
                <div className="col-span-2">
                  <p className="text-slate-400 text-sm">Description</p>
                  <p className="text-white">{debt.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Payment History */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold font-syne">Payment History</h2>
              <RecordPaymentModal
                debtId={debt.id}
                currentBalance={debt.current_balance}
                currency={debt.currency}
              />
            </div>
            {debt.payments?.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-400 text-sm border-b border-surface-200">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Method</th>
                    <th className="pb-2">Reference</th>
                    <th className="pb-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {debt.payments.map((p: any) => (
                    <tr key={p.id} className="border-b border-surface-100 text-sm">
                      <td className="py-2 text-slate-300">{formatDate(p.payment_date)}</td>
                      <td className="py-2 font-medium text-green-400">{formatCurrency(p.amount, debt.currency)}</td>
                      <td className="py-2 text-slate-300">{p.payment_method || '—'}</td>
                      <td className="py-2 text-slate-300 font-mono text-xs">{p.reference_number || '—'}</td>
                      <td className="py-2 text-slate-400">{p.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-400 text-center py-8">No payments recorded yet</p>
            )}
          </div>

          {/* Message History */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Message History</h2>
            {debt.messages?.length > 0 ? (
              <div className="space-y-3">
                {debt.messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg text-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface-300 text-slate-200'
                    }`}>
                      <p>{msg.content}</p>
                      <p className={`text-xs mt-1 ${msg.direction === 'outbound' ? 'text-brand-200' : 'text-slate-400'}`}>
                        {formatDate(msg.sent_at || msg.created_at)} • {msg.channel}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-8">No messages yet</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Customer</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-slate-400">Name</p>
                <p className="font-medium">{debt.customer?.full_name}</p>
              </div>
              <div>
                <p className="text-slate-400">Phone</p>
                <p className="font-medium">{debt.customer?.phone || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">WhatsApp</p>
                <p className="font-medium">{debt.customer?.whatsapp || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">National ID</p>
                <p className="font-medium font-mono">{debt.customer?.national_id || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">City</p>
                <p className="font-medium">{debt.customer?.city || '—'}</p>
              </div>
              <div>
                <p className="text-slate-400">Employer</p>
                <p className="font-medium">{debt.customer?.employer || '—'}</p>
              </div>
              {debt.customer?.monthly_income && (
                <div>
                  <p className="text-slate-400">Monthly Income</p>
                  <p className="font-medium">{formatCurrency(debt.customer.monthly_income, debt.currency)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Assigned To</h2>
            <AssignDebtSelect
              debtId={debt.id}
              currentAssigneeId={debt.assigned_to as string | null}
              collectors={collectors ?? []}
            />
          </div>

          {/* AI Score */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">AI Score</h2>
            {latestScore ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-4xl font-bold font-syne ${
                    latestScore.score >= 70 ? 'text-green-400' :
                    latestScore.score >= 40 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {latestScore.score}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{latestScore.risk_classification}</p>
                    <p className="text-xs text-slate-400">
                      {Math.round(latestScore.collection_probability * 100)}% collection probability
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Strategy</p>
                  <p className="text-sm">{latestScore.recommended_strategy}</p>
                </div>
                {latestScore.factors && (
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Key Factors</p>
                    <div className="space-y-1">
                      {latestScore.factors.slice(0, 4).map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-300">{f.name}</span>
                          <span className={f.impact === 'positive' ? 'text-green-400' : 'text-red-400'}>
                            {f.impact === 'positive' ? '+' : '−'}{f.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-slate-500">Scored {formatDate(latestScore.created_at)}</p>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No AI score yet. Click "Score Debt" to analyze.</p>
            )}

          {/* Customer 360: AI Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Recent AI Actions</h2>
            {aiActions?.length ? (
              <div className="space-y-3">
                {aiActions.map((a: any) => (
                  <div key={a.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{a.action_type}</span>
                      <span className="text-xs text-slate-400">{a.priority}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{a.reason}</p>
                    {a.suggested_message && <p className="text-xs text-slate-300 mt-2">{a.suggested_message}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No AI actions yet.</p>
            )}
          </div>

          {/* Customer 360: Alerts */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Active Alerts</h2>
            {debtAlerts?.length ? (
              <div className="space-y-3">
                {debtAlerts.map((al: any) => (
                  <div key={al.id} className="border border-red-500/20 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{al.title}</span>
                      <span className="text-xs text-red-400">{al.severity}</span>
                    </div>
                    {al.message && <p className="text-xs text-slate-400 mt-1">{al.message}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No active alerts.</p>
            )}
          </div>

          {/* Customer 360: Promises */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Promises</h2>
            {promises?.length ? (
              <div className="space-y-3">
                {promises.map((pr: any) => (
                  <div key={pr.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{formatCurrency(pr.promised_amount, debt.currency)}</span>
                      <span className="text-xs text-slate-400">{pr.status}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{formatDate(pr.promised_date)} • {pr.channel}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No promises yet.</p>
            )}
          </div>

          {/* Customer 360: Approvals */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Approvals</h2>
            {approvals?.length ? (
              <div className="space-y-3">
                {approvals.map((ap: any) => (
                  <div key={ap.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{ap.approval_type}</span>
                      <span className="text-xs text-slate-400">{ap.status}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{ap.reason}</p>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(ap.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No approvals yet.</p>
            )}
          </div>

          {/* Customer 360: AI Memory */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">AI Memory</h2>
            {memoryEntries?.length ? (
              <div className="space-y-3">
                {memoryEntries.map((m: any) => (
                  <div key={m.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{m.trigger_pattern}</span>
                      <span className="text-xs text-slate-400">{m.category}</span>
                    </div>
                    <p className="text-xs text-slate-300 mt-2">{m.response_text}</p>
                    <p className="text-xs text-slate-500 mt-1">Used {m.use_count ?? 0} times</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No memory entries yet.</p>
            )}
          </div>

          {/* Collection Intelligence */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Collection Intelligence</h2>

            {collectionFollowups?.length ? (
              <div className="space-y-3 mb-5">
                <p className="text-xs text-slate-400">Latest Followups</p>
                {collectionFollowups.map((f: any) => (
                  <div key={f.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{f.original_status || f.normalized_status || 'Followup'}</span>
                      <span className="text-xs text-slate-500">{formatDate(f.occurred_at)}</span>
                    </div>
                    {f.original_sub_status && <p className="text-xs text-slate-400 mt-1">{f.original_sub_status}</p>}
                    {f.customer_statement && <p className="text-xs text-slate-300 mt-2">Customer: {f.customer_statement}</p>}
                    {f.collector_note && <p className="text-xs text-slate-400 mt-1">Note: {f.collector_note}</p>}
                    {f.result_summary && <p className="text-xs text-brand-300 mt-1">{f.result_summary}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm mb-4">No collection followups yet.</p>
            )}

            {collectionStatusHistory?.length ? (
              <div className="space-y-3 mb-5">
                <p className="text-xs text-slate-400">Status History</p>
                {collectionStatusHistory.map((s: any) => (
                  <div key={s.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{s.new_status}</span>
                      <span className="text-xs text-slate-500">{formatDate(s.changed_at)}</span>
                    </div>
                    {s.new_sub_status && <p className="text-xs text-slate-400 mt-1">{s.new_sub_status}</p>}
                    {s.old_status && <p className="text-xs text-slate-500 mt-1">From: {s.old_status}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm mb-4">No status history yet.</p>
            )}

            {collectionAssignments?.length ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">Assignments</p>
                {collectionAssignments.map((a: any) => (
                  <div key={a.id} className="border border-surface-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{a.assigned_to_name || 'Unassigned'}</span>
                      <span className="text-xs text-slate-500">{a.assignment_status || 'assignment'}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(a.assigned_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No assignment history yet.</p>
            )}
          </div>

          {/* Customer 360: Timeline */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Recent Timeline</h2>
            {timelineEvents?.length ? (
              <div className="space-y-3">
                {timelineEvents.map((ev: any) => (
                  <div key={ev.id} className="border-l-2 border-brand-500/40 pl-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{ev.summary}</span>
                      <span className="text-xs text-slate-500">{ev.channel || 'system'}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{formatDate(ev.occurred_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No timeline events yet.</p>
            )}
          </div>

          </div>
        </div>
      </div>
    </div>
  )
}




