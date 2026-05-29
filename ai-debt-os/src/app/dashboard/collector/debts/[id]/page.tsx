import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import RecordPaymentModal from '@/components/debt/RecordPaymentModal'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function CollectorDebtDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: debt } = await supabase
    .from('debts')
    .select(`
      *,
      customer:customers(*),
      payments(*),
      messages(*, created_at),
      ai_scores(*)
    `)
    .eq('id', params.id)
    .eq('assigned_to', user.id)
    .single()

  if (!debt) notFound()

  const latestScore = (debt.ai_scores as any[])?.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]

  const totalPaid = (debt.payments as any[])?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0
  const customer = debt.customer as any

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/collector/debts" className="text-slate-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-syne">{debt.reference_number}</h1>
          <p className="text-slate-400">{customer?.full_name}</p>
        </div>
        <div className="ml-auto">
          <SendWhatsAppButton
            debtId={debt.id}
            phone={customer?.whatsapp || customer?.phone}
            customerName={customer?.full_name}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Overview */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Debt Overview</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Original Amount</p>
                <p className="text-xl font-bold">{formatCurrency(debt.original_amount, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400">Current Balance</p>
                <p className="text-xl font-bold text-brand-400">{formatCurrency(debt.current_balance, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400">Total Paid</p>
                <p className="text-xl font-bold text-green-400">{formatCurrency(totalPaid, debt.currency)}</p>
              </div>
              <div>
                <p className="text-slate-400">Due Date</p>
                <p className="text-xl font-bold">{formatDate(debt.due_date)}</p>
              </div>
              <div>
                <p className="text-slate-400">Status</p>
                <span className="px-2 py-1 rounded text-xs bg-surface-300 text-slate-300">
                  {(debt.status as string).replace(/_/g, ' ')}
                </span>
              </div>
              {debt.notes && (
                <div className="col-span-2">
                  <p className="text-slate-400">Notes</p>
                  <p className="text-white">{debt.notes as string}</p>
                </div>
              )}
            </div>
          </div>

          {/* Payments */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold font-syne">Payments</h2>
              <RecordPaymentModal debtId={debt.id} currentBalance={Number(debt.current_balance)} currency={debt.currency as string} />
            </div>
            {(debt.payments as any[])?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-surface-200">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Amount</th>
                    <th className="pb-2">Method</th>
                    <th className="pb-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(debt.payments as any[]).map((p) => (
                    <tr key={p.id} className="border-b border-surface-100">
                      <td className="py-2 text-slate-300">{formatDate(p.payment_date)}</td>
                      <td className="py-2 font-medium text-green-400">{formatCurrency(p.amount, debt.currency as string)}</td>
                      <td className="py-2 text-slate-300">{p.payment_method || '—'}</td>
                      <td className="py-2 text-slate-400">{p.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-slate-400 text-center py-6">No payments recorded</p>
            )}
          </div>

          {/* Messages */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Messages</h2>
            {(debt.messages as any[])?.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {(debt.messages as any[]).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((msg) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-2 rounded-lg text-sm ${msg.direction === 'outbound' ? 'bg-brand-600' : 'bg-surface-300'}`}>
                      <p>{msg.content}</p>
                      <p className="text-xs mt-1 opacity-60">{formatDate(msg.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">No messages yet</p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          {/* Customer Info */}
          <div className="card">
            <h2 className="text-lg font-semibold font-syne mb-4">Customer</h2>
            <div className="space-y-3 text-sm">
              <div><p className="text-slate-400">Name</p><p className="font-medium">{customer?.full_name}</p></div>
              <div><p className="text-slate-400">Phone</p><p className="font-medium">{customer?.phone || '—'}</p></div>
              <div><p className="text-slate-400">WhatsApp</p><p className="font-medium">{customer?.whatsapp || '—'}</p></div>
              <div><p className="text-slate-400">City</p><p className="font-medium">{customer?.city || '—'}</p></div>
              <div><p className="text-slate-400">Employer</p><p className="font-medium">{customer?.employer || '—'}</p></div>
              {customer?.monthly_income && (
                <div><p className="text-slate-400">Monthly Income</p><p className="font-medium">{formatCurrency(customer.monthly_income, debt.currency as string)}</p></div>
              )}
            </div>
          </div>

          {/* AI Score */}
          {latestScore && (
            <div className="card">
              <h2 className="text-lg font-semibold font-syne mb-4">AI Score</h2>
              <div className="flex items-center gap-3 mb-3">
                <div className={`text-4xl font-bold font-syne ${latestScore.score >= 70 ? 'text-green-400' : latestScore.score >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {latestScore.score}
                </div>
                <div>
                  <p className="text-sm font-medium">{latestScore.risk_classification}</p>
                  <p className="text-xs text-slate-400">{Math.round(latestScore.collection_probability * 100)}% probability</p>
                </div>
              </div>
              <p className="text-sm text-slate-300">{latestScore.recommended_strategy}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
