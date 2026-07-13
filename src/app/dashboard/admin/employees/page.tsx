import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'
import EmployeeImportPanel from '@/components/employees/EmployeeImportPanel'

export default async function EmployeesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id || profile.role !== 'admin') redirect(`/dashboard/${profile?.role ?? 'admin'}`)

  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, email, job_title, branch, portfolio_name, work_phone, status, profile_id')
    .eq('company_id', profile.company_id)
    .order('status', { ascending: true })
    .order('full_name', { ascending: true })

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center gap-4 mt-6">
        <div className="w-12 h-12 bg-[#0e7a54]/10 text-[#0e7a54] rounded-xl flex items-center justify-center shrink-0">
          <Users size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">دليل الموظفين</h1>
          <p className="text-[#8b95a7] text-sm">مزامنة بيانات الموظفين من ملف Excel وإنشاء حسابات المحصلين تلقائياً.</p>
        </div>
      </div>

      <EmployeeImportPanel />

      {employees && employees.length > 0 && (
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0d1117] text-[#8b95a7] text-xs">
                <th className="px-4 py-3 text-start font-bold">الاسم</th>
                <th className="px-4 py-3 text-start font-bold">البريد</th>
                <th className="px-4 py-3 text-start font-bold">الوظيفة</th>
                <th className="px-4 py-3 text-start font-bold">الفرع</th>
                <th className="px-4 py-3 text-start font-bold">المحفظة</th>
                <th className="px-4 py-3 text-start font-bold">الهاتف</th>
                <th className="px-4 py-3 text-start font-bold">حساب دخول</th>
                <th className="px-4 py-3 text-start font-bold">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e: any) => (
                <tr key={e.id} className="border-t border-[#222a36]">
                  <td className="px-4 py-3 font-bold text-white">{e.full_name}</td>
                  <td className="px-4 py-3 text-[#8b95a7] font-mono text-xs">{e.email}</td>
                  <td className="px-4 py-3 text-[#8b95a7]">{e.job_title ?? '—'}</td>
                  <td className="px-4 py-3 text-[#8b95a7]">{e.branch ?? '—'}</td>
                  <td className="px-4 py-3 text-[#8b95a7]">{e.portfolio_name ?? '—'}</td>
                  <td className="px-4 py-3 text-[#8b95a7] font-mono text-xs" dir="ltr">{e.work_phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    {e.profile_id ? (
                      <span className="text-emerald-400 text-xs font-bold">مفعّل</span>
                    ) : (
                      <span className="text-[#5f6b7e] text-xs">لا يوجد</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded-md text-xs font-bold ${e.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[#222a36] text-[#5f6b7e]'}`}>
                      {e.status === 'active' ? 'نشط' : 'غير نشط'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
