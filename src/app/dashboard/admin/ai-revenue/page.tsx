import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAIvsHumanSummary, getChannelSummary } from '@/lib/revenue-attribution'
import { TrendingUp, Info } from 'lucide-react'

function Money({ value }: { value: number }) {
  return <>{Math.round(value).toLocaleString()} ريال</>
}

function StatCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-5 shadow-sm">
      <div className="text-[#8b95a7] text-xs uppercase tracking-wider font-bold">{title}</div>
      <div className="text-2xl font-bold text-white mt-1 font-mono">{value}</div>
      {sub && <div className="text-[#5f6b7e] text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function AIRevenuePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  const since = new Date()
  since.setDate(since.getDate() - 30)

  const periodStart = since.toISOString()
  const periodEnd = new Date().toISOString()

  const [summary, channels] = await Promise.all([
    getAIvsHumanSummary(profile.company_id, periodStart),
    getChannelSummary(profile.company_id, periodStart, periodEnd),
  ])

  const aiTotal = summary.ai + summary.ai_assisted
  const total = summary.ai + summary.ai_assisted + summary.human
  const aiShare = total > 0 ? Math.round((aiTotal / total) * 100) : 0
  const humanShare = total > 0 ? Math.round((summary.human / total) * 100) : 0
  const hasAnyData = total > 0

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center gap-4 mt-6">
        <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0"><TrendingUp size={24} /></div>
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">عائدات الذكاء الاصطناعي (AI Revenue Attribution)</h1>
          <p className="text-[#8b95a7] text-sm">المبالغ المحصَّلة بواسطة AI، بمساعدته، أو بواسطة محصّل بشري — آخر 30 يوماً</p>
        </div>
      </div>

      {!hasAnyData && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 flex items-start gap-3">
          <Info className="text-amber-400 shrink-0 mt-0.5" size={20} />
          <div>
            <div className="font-bold text-amber-400">لا توجد بيانات حقيقية بعد — وليست صفحة معطّلة</div>
            <div className="text-[#8b95a7] text-sm mt-1">
              لم يُسجَّل أي سداد أو إغلاق دين بواسطة AI خلال آخر 30 يوماً حتى الآن. الأرقام أدناه ستظهر تلقائياً
              فور أول وعد أو سداد فعلي يؤكّده الوكيل — لا حاجة لأي إجراء إضافي.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="حصّله AI مباشرة" value={`${Math.round(summary.ai).toLocaleString()} ريال`} sub={`${summary.ai_count} عملية سداد منسوبة مباشرة لـAI`} />
        <StatCard title="بمساعدة AI" value={`${Math.round(summary.ai_assisted).toLocaleString()} ريال`} sub="سدادات شارك فيها AI دون أن يكون المنفّذ المباشر" />
        <StatCard title="حصّله محصّل بشري" value={`${Math.round(summary.human).toLocaleString()} ريال`} sub={`${summary.human_count} عملية سداد يدوية`} />
        <StatCard title="نسبة AI" value={`${aiShare}%`} sub={`نسبة المحصّلين البشر ${humanShare}%`} />
      </div>

      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6">
        <h2 className="font-bold text-xl text-white mb-4">التحصيل بحسب القناة</h2>

        {channels.length === 0 ? (
          <div className="text-[#8b95a7] text-sm">لا توجد بيانات تحصيل مسجَّلة بعد لهذي الفترة.</div>
        ) : (
          <div className="space-y-3">
            {channels.map((row) => (
              <div key={row.channel} className="flex items-center justify-between border-b border-[#222a36] pb-3">
                <div>
                  <div className="text-white font-medium capitalize">{row.channel.replace('_', ' ')}</div>
                  <div className="text-[#5f6b7e] text-xs">{row.count} عملية سداد · متوسط {row.avg_days} يوم للتحصيل</div>
                </div>
                <div className="text-white font-semibold font-mono"><Money value={row.total_amount} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6">
        <h2 className="font-bold text-xl text-white mb-2">كيف يعمل هذا فعلياً</h2>
        <p className="text-[#8b95a7] text-sm leading-6">
          كل وعد يسجّله الوكيل، وكل سداد يؤكّده عبر قراءة الإيصال، وكل دين يُغلَق نتيجة لذلك — يُسجَّل كحدث Attribution فعلي
          في جدول <code className="text-emerald-400 font-mono">collection_attribution</code>، لا واجهة Mock. هذي الصفحة تقرأ من نفس الجدول مباشرة.
        </p>
      </div>
    </div>
  )
}
