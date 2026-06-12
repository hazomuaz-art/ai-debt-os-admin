import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import { Users } from 'lucide-react'

export default async function ManagerTeamPage() {
  const supabase = createClient()

  const { data: collectors } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'collector')

  // For each collector, get stats
  const collectorStats = await Promise.all(
    (collectors ?? []).map(async (c) => {
      const { data: assigned } = await supabase
        .from('debts')
        .select('id, current_balance, currency, status')
        .eq('assigned_to', c.id)

      const totalAssigned = assigned?.length ?? 0
      const settled = assigned?.filter(d => d.status === 'settled').length ?? 0
      const totalBalance = assigned?.reduce((s, d) => s + Number(d.current_balance), 0) ?? 0

      return { ...c, totalAssigned, settled, totalBalance }
    })
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Team Performance</h1>
        <p className="text-slate-400">Collector statistics and workload</p>
      </div>

      {collectorStats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {collectorStats.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center font-bold text-sm">
                  {c.full_name?.charAt(0) ?? '?'}
                </div>
                <div>
                  <p className="font-semibold">{c.full_name}</p>
                  <p className="text-slate-400 text-xs">{c.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-bold font-syne">{c.totalAssigned}</p>
                  <p className="text-xs text-slate-400">Assigned</p>
                </div>
                <div>
                  <p className="text-2xl font-bold font-syne text-green-400">{c.settled}</p>
                  <p className="text-xs text-slate-400">Settled</p>
                </div>
                <div>
                  <p className="text-sm font-bold text-brand-400 truncate">{formatCurrency(c.totalBalance, 'SAR')}</p>
                  <p className="text-xs text-slate-400">Portfolio</p>
                </div>
              </div>
              {c.totalAssigned > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Collection rate</span>
                    <span>{Math.round((c.settled / c.totalAssigned) * 100)}%</span>
                  </div>
                  <div className="w-full bg-slate-50 rounded-full h-1.5">
                    <div
                      className="bg-brand-500 h-1.5 rounded-full"
                      style={{ width: `${Math.round((c.settled / c.totalAssigned) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No collectors in your team yet</p>
        </div>
      )}
    </div>
  )
}
