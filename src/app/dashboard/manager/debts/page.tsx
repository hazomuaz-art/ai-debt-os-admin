import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { FileText, Filter } from 'lucide-react'

export default async function ManagerDebtsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) redirect('/dashboard/collector')

  let query = supabase
    .from('debts')
    .select(`
      *,
      customer:customers(full_name, phone),
      assigned_to_profile:profiles!debts_assigned_to_fkey(full_name)
    `)
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })

  if (searchParams.status) query = (query as any).eq('status', searchParams.status)

  const { data: debts } = await query

  const statuses = [
    { id: 'active', label: 'نشط' },
    { id: 'in_negotiation', label: 'قيد التفاوض' },
    { id: 'payment_plan', label: 'مُجدول' },
    { id: 'settled', label: 'مُسدد' },
    { id: 'legal', label: 'إجراء قانوني' },
    { id: 'written_off', label: 'معدوم' }
  ]

  const getPriorityStyle = (p: string) => {
    if (p === 'critical' || p === 'high') return 'bg-rose-50 text-rose-600 border-rose-200'
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border-amber-200'
    return 'bg-blue-50 text-blue-600 border-blue-200'
  }

  const getPriorityLabel = (p: string) => {
    const labels: Record<string, string> = { critical: 'حرج جداً', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' }
    return labels[p] ?? p
  }

  const getStatusLabel = (s: string) => {
    const st = statuses.find(x => x.id === s)
    return st?.label ?? s.replace(/_/g, ' ');
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <FileText size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">جميع المطالبات</h1>
            <p className="text-[#8b95a7] text-sm">إجمالي الملفات: <span className="font-bold text-white font-mono">{debts?.length ?? 0}</span></p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center bg-[#151a23] p-2 rounded-2xl border border-[#222a36] shadow-sm px-4">
        <Filter size={16} className="text-[#5f6b7e] ms-2" />
        <Link href="/dashboard/manager/debts"
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${!searchParams.status ? 'bg-[#0e7a54] text-white shadow-sm' : 'bg-[#222a36] text-[#8b95a7] hover:text-white hover:bg-[#222a36]'}`}>
          الكل
        </Link>
        {statuses.map(s => (
          <Link key={s.id} href={`/dashboard/manager/debts?status=${s.id}`}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${searchParams.status === s.id ? 'bg-[#0e7a54] text-white shadow-sm' : 'bg-[#222a36] text-[#8b95a7] hover:text-white hover:bg-[#222a36]'}`}>
            {s.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] border-b border-[#222a36] text-xs">
              <tr>
                <th className="py-4 px-6 font-bold uppercase">المرجع</th>
                <th className="py-4 px-6 font-bold uppercase">العميل</th>
                <th className="py-4 px-6 font-bold uppercase">الرصيد المتبقي</th>
                <th className="py-4 px-6 font-bold uppercase">الحالة</th>
                <th className="py-4 px-6 font-bold uppercase">الأولوية</th>
                <th className="py-4 px-6 font-bold uppercase">المحصل</th>
                <th className="py-4 px-6 font-bold uppercase">تاريخ الاستحقاق</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {debts?.map((debt: any) => (
                <tr key={debt.id} className="hover:bg-[#1a212c] transition-colors">
                  <td className="py-4 px-6">
                    <Link href={`/dashboard/manager/debts/${debt.id}`} className="font-mono text-xs font-bold text-blue-600 hover:underline bg-blue-50 px-2 py-1 rounded-md">
                      {debt.reference_number}
                    </Link>
                  </td>
                  <td className="py-4 px-6">
                    <p className="font-bold text-white">{debt.customer?.full_name}</p>
                    <p className="text-xs text-[#5f6b7e] font-mono mt-0.5">{debt.customer?.phone}</p>
                  </td>
                  <td className="py-4 px-6 font-bold font-mono text-white">{formatCurrency(debt.current_balance, debt.currency)}</td>
                  <td className="py-4 px-6">
                    <span className="px-2 py-1 rounded-md text-xs font-bold bg-[#222a36] text-slate-300 border border-[#222a36]">
                      {getStatusLabel(debt.status)}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`px-2 py-1 rounded-md text-xs font-bold border ${getPriorityStyle(debt.priority)}`}>
                      {getPriorityLabel(debt.priority)}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-white font-bold text-xs">{debt.assigned_to_profile?.full_name || 'غير مسند'}</td>
                  <td className="py-4 px-6 text-[#8b95a7] text-xs font-mono">{formatDate(debt.due_date)}</td>
                </tr>
              ))}
              {(!debts || debts.length === 0) && (
                <tr>
                  <td colSpan={7} className="text-center py-12 bg-[#222a36]/50">
                    <div className="text-[#5f6b7e] text-sm font-bold">لا توجد مطالبات تطابق البحث</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
