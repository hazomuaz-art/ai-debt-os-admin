import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import AddWhatsAppNumberModal from '@/components/whatsapp-numbers/AddWhatsAppNumberModal'
import WhatsAppNumberCard from '@/components/whatsapp-numbers/WhatsAppNumberCard'

// Real gap found during a full-system audit: portfolio_whatsapp_numbers
// (lets each portfolio/team have its own dedicated WhatsApp line, separate
// from the main default AI number — send-campaign-queue.ts already reads
// and uses this table) had a complete backend (list/create/connect via QR/
// disconnect) but no page anywhere in the app ever rendered it.
export default async function WhatsAppNumbersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/admin')

  const { data: numbers } = await supabase
    .from('portfolio_whatsapp_numbers')
    .select('*, portfolio:portfolios(name, name_ar)')
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })

  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id, name, name_ar')
    .eq('company_id', profile.company_id)
    .order('name')

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0e7a54]/10 text-[#0e7a54] rounded-xl flex items-center justify-center shrink-0">
            <MessageCircle size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">أرقام واتساب المحافظ</h1>
            <p className="text-[#8b95a7] text-sm">اربط رقم واتساب مستقل لكل محفظة أو فريق، منفصل تماماً عن الرقم الرئيسي للوكيل الذكي.</p>
          </div>
        </div>
        {portfolios && portfolios.length > 0 && <AddWhatsAppNumberModal portfolios={portfolios} />}
      </div>

      {!portfolios?.length ? (
        <div className="bg-[#151a23] rounded-2xl p-8 text-center border border-[#222a36] border-dashed">
          <p className="text-[#5f6b7e] font-bold">أنشئ محفظة أولاً قبل إضافة رقم واتساب.</p>
        </div>
      ) : !numbers?.length ? (
        <div className="bg-[#151a23] rounded-2xl p-8 text-center border border-[#222a36] border-dashed">
          <p className="text-[#5f6b7e] font-bold">لا توجد أرقام واتساب إضافية بعد.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {numbers.map((n: any) => <WhatsAppNumberCard key={n.id} number={n} />)}
        </div>
      )}
    </div>
  )
}
