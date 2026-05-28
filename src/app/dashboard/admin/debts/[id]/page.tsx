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
import { buildCustomerContext } from '@/lib/ai-context'
import { determineAutomationAction } from '@/lib/automation-engine'

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

  const totalPaid = debt.payments?.reduce((sum: number, p: any) => sum + Number(p.amount), 0) ?? 0

  const aiContext = await buildCustomerContext({
    company_id: debt.company_id,
    customer_id: debt.customer_id
  })

  const automationDecision = determineAutomationAction({
    customer_status: aiContext.customer_status,
    engagement_score: aiContext.engagement_score,
    has_promise: !!aiContext.last_promise,
    has_recent_payment: !!aiContext.last_payment
  })


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

      <div className="card border border-cyan-500/20 bg-cyan-500/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold font-syne">AI Intelligence</h2>

          <span className="px-3 py-1 rounded-full text-xs bg-cyan-500/20 text-cyan-300">
            {aiContext.customer_status}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-slate-400 text-sm">Engagement</p>
            <p className="text-2xl font-bold text-cyan-400">
              {aiContext.engagement_score}%
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-sm">AI Action</p>
            <p className="text-lg font-semibold text-white">
              {automationDecision.action}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-sm">Priority</p>
            <p className="text-lg font-semibold text-yellow-400">
              {automationDecision.priority}
            </p>
          </div>

          <div>
            <p className="text-slate-400 text-sm">Recent Events</p>
            <p className="text-lg font-semibold text-green-400">
              {aiContext.recent_events?.length ?? 0}
            </p>
          </div>
        </div>

        <div className="mt-4 p-4 rounded-xl bg-black/20 border border-white/5">
          <p className="text-slate-400 text-sm mb-1">AI Recommendation</p>
          <p className="text-white">
            {automationDecision.reason}
          </p>
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
                      <td className="py-2 text-slate-300">{p.payment_method || 'â€”'}</td>
                      <td className="py-2 text-slate-300 font-mono text-xs">{p.reference_number || 'â€”'}</td>
                      <td className="py-2 text-slate-400">{p.notes || 'â€”'}</td>
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
                        {formatDate(msg.sent_at || msg.created_at)} â€¢ {msg.channel}
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
                <p className="font-medium">{debt.customer?.phone || 'â€”'}</p>
              </div>
              <div>
                <p className="text-slate-400">WhatsApp</p>
                <p className="font-medium">{debt.customer?.whatsapp || 'â€”'}</p>
              </div>
              <div>
                <p className="text-slate-400">National ID</p>
                <p className="font-medium font-mono">{debt.customer?.national_id || 'â€”'}</p>
              </div>
              <div>
                <p className="text-slate-400">City</p>
                <p className="font-medium">{debt.customer?.city || 'â€”'}</p>
              </div>
              <div>
                <p className="text-slate-400">Employer</p>
                <p className="font-medium">{debt.customer?.employer || 'â€”'}</p>
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
                            {f.impact === 'positive' ? '+' : 'âˆ’'}{f.weight}
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
          </div>
        </div>
      </div>
    </div>
  )
}



