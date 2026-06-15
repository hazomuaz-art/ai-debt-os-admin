'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

// Light Theme Harmonized Colors
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4']

const STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6', // blue
  in_progress: '#0ea5e9', // sky
  promised: '#f59e0b', // amber
  partial: '#10b981', // emerald
  in_negotiation: '#8b5cf6', // violet
  payment_plan: '#06b6d4', // cyan
  settled: '#22c55e', // green
  written_off: '#94a3b8', // slate
  legal: '#ef4444', // red
  disputed: '#f97316', // orange
}

const STATUS_ARABIC: Record<string, string> = {
  active: 'نشط',
  in_progress: 'قيد التنفيذ',
  promised: 'وعود سداد',
  partial: 'سداد جزئي',
  in_negotiation: 'في التفاوض',
  payment_plan: 'خطة سداد',
  settled: 'مُسدد',
  written_off: 'معدوم',
  legal: 'إجراء قانوني',
  disputed: 'متنازع عليه',
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#94a3b8',
}

const PRIORITY_ARABIC: Record<string, string> = {
  critical: 'حرج',
  high: 'عالي',
  medium: 'متوسط',
  low: 'منخفض',
}

interface Props {
  monthlyData: { month: string; collected: number; newDebts: number }[]
  statusChartData: { name: string; value: number }[]
  channelChartData: { name: string; value: number }[]
  priorityChartData: { name: string; value: number }[]
  riskChartData: { name: string; value: number }[]
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4 text-sm shadow-xl font-bold text-[#0e7a54] text-start" >
      {label && <p className="text-slate-400 mb-2 border-b border-slate-50 pb-2">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="flex justify-between gap-4 mt-1">
          <span>{p.name === 'Collected' ? 'المحصل:' : p.name === 'New Debts' ? 'الديون الجديدة:' : p.name}</span>
          <span className="font-mono">
            {typeof p.value === 'number' && p.value > 1000 && p.name === 'Collected'
              ? formatCurrency(p.value, 'SAR')
              : p.value}
          </span>
        </p>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  const name = STATUS_ARABIC[entry.name] || PRIORITY_ARABIC[entry.name] || entry.name
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3 text-sm shadow-xl font-bold text-start" >
      <p style={{ color: entry.payload.fill }}>{name}: <span className="font-mono">{entry.value}</span></p>
    </div>
  )
}

export default function AnalyticsCharts({
  monthlyData,
  statusChartData,
  channelChartData,
  priorityChartData,
  riskChartData,
}: Props) {
  return (
    <div className="space-y-6" >
      {/* Monthly Collection Bar Chart */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-lg font-bold text-[#0e7a54] mb-6">التحصيلات الشهرية (بالريال السعودي)</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 16, bottom: 4 }} style={{ direction: 'ltr' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="collected" name="Collected" fill="#3b82f6" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* New Debts per Month */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-lg font-bold text-[#0e7a54] mb-6">الديون الجديدة المضافة شهرياً</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }} style={{ direction: 'ltr' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="newDebts" name="New Debts" fill="#10b981" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pie charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-[#0e7a54] mb-4">توزيع حالات الديون</h2>
          {statusChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={3}
                  stroke="none"
                >
                  {statusChartData.map((entry, i) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-slate-600 text-xs font-bold me-1">{STATUS_ARABIC[value] || value.replace(/_/g, ' ')}</span>}
                  wrapperStyle={{ direction: 'rtl' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16 font-bold text-sm">لا توجد بيانات للديون حتى الآن</p>
          )}
        </div>

        {/* Priority Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-[#0e7a54] mb-4">توزيع الأهمية (الأولويات)</h2>
          {priorityChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={priorityChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={3}
                  stroke="none"
                >
                  {priorityChartData.map((entry) => (
                    <Cell key={entry.name} fill={PRIORITY_COLORS[entry.name] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-slate-600 text-xs font-bold me-1">{PRIORITY_ARABIC[value] || value}</span>}
                  wrapperStyle={{ direction: 'rtl' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16 font-bold text-sm">لا توجد بيانات للأولويات</p>
          )}
        </div>

        {/* Channel Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-[#0e7a54] mb-4">قنوات التواصل المستخدمة</h2>
          {channelChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={channelChartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={2}
                  stroke="none"
                >
                  {channelChartData.map((entry, i) => (
                    <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltip />} />
                <Legend
                  formatter={(value) => <span className="text-slate-600 text-xs font-bold me-1 capitalize">{value}</span>}
                  wrapperStyle={{ direction: 'rtl' }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16 font-bold text-sm">لم يتم إرسال أي رسائل بعد</p>
          )}
        </div>

        {/* AI Risk Classification */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-lg font-bold text-[#0e7a54] mb-4">تصنيف الذكاء الاصطناعي للمخاطر</h2>
          {riskChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={riskChartData} layout="vertical" margin={{ left: 16, right: 16 }} style={{ direction: 'ltr' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="value" name="Debts" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-400 text-center py-16 font-bold text-sm">لا يوجد تقييم مخاطر مسجل بعد</p>
          )}
        </div>
      </div>
    </div>
  )
}
