'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback } from 'react'
import { Search, Filter, X } from 'lucide-react'

export default function DebtFilters({
  collectors,
  creditors,
  productTypes
}: {
  collectors: { id: string, full_name: string }[]
  creditors: string[]
  productTypes: string[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [q, setQ] = useState(searchParams.get('q') || '')
  
  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(name, value)
      } else {
        params.delete(name)
      }
      params.set('page', '1') // reset page on filter change
      return params.toString()
    },
    [searchParams]
  )

  const handleFilterChange = (name: string, value: string) => {
    router.push(`?${createQueryString(name, value)}`)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    handleFilterChange('q', q)
  }

  const clearFilters = () => {
    router.push('?')
    setQ('')
  }

  const currentStatus = searchParams.get('status') || ''
  const currentCreditor = searchParams.get('creditor') || ''
  const currentProduct = searchParams.get('product') || ''
  const currentCollector = searchParams.get('collector') || ''

  const hasActiveFilters = currentStatus || currentCreditor || currentProduct || currentCollector || q

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-[#1e3e50] text-sm flex items-center gap-2">
          <Filter size={16} className="text-blue-500" /> الفرز والتصفية المتقدمة
        </h3>
        {hasActiveFilters && (
          <button 
            onClick={clearFilters}
            className="text-xs font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            <X size={12} /> مسح الفلاتر
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <form onSubmit={handleSearch} className="relative lg:col-span-1">
          <input
            type="text"
            placeholder="بحث برقم المرجع أو العقد..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl pl-10 pr-4 py-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none placeholder:text-slate-400 font-medium"
          />
          <button type="submit" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500">
            <Search size={16} />
          </button>
        </form>

        {/* Creditor / Client Filter */}
        <select 
          value={currentCreditor}
          onChange={(e) => handleFilterChange('creditor', e.target.value)}
          className="bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none font-bold"
        >
          <option value="">كل الشركات / الجهات</option>
          {creditors.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* Product Type Filter */}
        <select 
          value={currentProduct}
          onChange={(e) => handleFilterChange('product', e.target.value)}
          className="bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none font-bold"
        >
          <option value="">كل أنواع المنتجات</option>
          {productTypes.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* Operational Status Filter */}
        <select 
          value={currentStatus}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          className="bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none font-bold"
        >
          <option value="">كل الحالات التشغيلية</option>
          <option value="active">جديد / نشط</option>
          <option value="in_progress">قيد المتابعة</option>
          <option value="promised">وعد بالسداد</option>
          <option value="disputed">اعتراض / مراجعة</option>
          <option value="human_handoff">تدخل بشري</option>
        </select>

        {/* Collector Filter */}
        {collectors.length > 0 && (
          <select 
            value={currentCollector}
            onChange={(e) => handleFilterChange('collector', e.target.value)}
            className="bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none font-bold"
          >
            <option value="">كل المحصلين</option>
            {collectors.map(c => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
            <option value="unassigned">غير مسند</option>
          </select>
        )}

      </div>
    </div>
  )
}
