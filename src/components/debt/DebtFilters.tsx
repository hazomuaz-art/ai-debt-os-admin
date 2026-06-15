'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback } from 'react'
import { Search, Filter, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

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
  const { t } = useTranslation()
  const f = t.pages.debts

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

  const selectCls = "bg-[#0d1117] border border-[#222a36] text-slate-200 rounded-xl px-4 py-2.5 text-xs focus:ring-2 focus:ring-[#10b981] outline-none font-bold"

  return (
    <div className="bg-[#151a23] p-4 rounded-2xl border border-[#222a36] space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <Filter size={16} className="text-[#10b981]" /> {f.f_title}
        </h3>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            <X size={12} /> {f.f_clear}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <form onSubmit={handleSearch} className="relative lg:col-span-1">
          <input
            type="text"
            placeholder={f.f_search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#222a36] text-slate-200 rounded-xl ps-10 pe-4 py-2.5 text-xs focus:ring-2 focus:ring-[#10b981] outline-none placeholder:text-[#5f6b7e] font-medium"
          />
          <button type="submit" className="absolute start-3 top-1/2 -translate-y-1/2 text-[#5f6b7e] hover:text-[#10b981]">
            <Search size={16} />
          </button>
        </form>

        {/* Creditor Filter */}
        <select value={currentCreditor} onChange={(e) => handleFilterChange('creditor', e.target.value)} className={selectCls}>
          <option value="">{f.f_all_creditors}</option>
          {creditors.map(c => (<option key={c} value={c}>{c}</option>))}
        </select>

        {/* Product Type Filter */}
        <select value={currentProduct} onChange={(e) => handleFilterChange('product', e.target.value)} className={selectCls}>
          <option value="">{f.f_all_products}</option>
          {productTypes.map(p => (<option key={p} value={p}>{p}</option>))}
        </select>

        {/* Operational Status Filter */}
        <select value={currentStatus} onChange={(e) => handleFilterChange('status', e.target.value)} className={selectCls}>
          <option value="">{f.f_all_statuses}</option>
          <option value="active">{f.f_s_active}</option>
          <option value="in_progress">{f.f_s_in_progress}</option>
          <option value="promised">{f.f_s_promised}</option>
          <option value="disputed">{f.f_s_disputed}</option>
          <option value="human_handoff">{f.f_s_handoff}</option>
        </select>

        {/* Collector Filter */}
        {collectors.length > 0 && (
          <select value={currentCollector} onChange={(e) => handleFilterChange('collector', e.target.value)} className={selectCls}>
            <option value="">{f.f_all_collectors}</option>
            {collectors.map(c => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
            <option value="unassigned">{f.f_unassigned}</option>
          </select>
        )}

      </div>
    </div>
  )
}
