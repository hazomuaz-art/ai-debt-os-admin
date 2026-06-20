'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PORTFOLIO_DATA_TABLES } from '@/lib/portfolio-data-fields'

type Portfolio = { id: string; name: string; name_ar: string | null; metadata: Record<string, unknown> | null }

// Dropdown to pick a portfolio + the dynamic fields specific to it.
// Used by AddCaseModal / CreateCustomerModal so manual entry captures the
// same per-portfolio columns the importer routes into customer_data_<table>.
export function PortfolioFieldsSection() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [companyKey, setCompanyKey] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('portfolios').select('id, name, name_ar, metadata').order('name')
      .then((res: { data: Portfolio[] | null }) => setPortfolios(res.data ?? []))
  }, [])

  function onSelect(id: string) {
    setSelectedId(id)
    const p = portfolios.find(p => p.id === id)
    setCompanyKey((p?.metadata?.company_key as string | undefined) ?? null)
  }

  const config = companyKey ? PORTFOLIO_DATA_TABLES[companyKey] : null

  return (
    <div className="border-t border-[#222a36] pt-4">
      <div className="text-xs font-bold text-emerald-400 mb-3">المحفظة</div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">المحفظة</label>
          <select name="portfolio_id" className="input" value={selectedId} onChange={e => onSelect(e.target.value)}>
            <option value="">بدون محفظة</option>
            {portfolios.map(p => (
              <option key={p.id} value={p.id}>{p.name_ar ?? p.name}</option>
            ))}
          </select>
          {companyKey && <input type="hidden" name="company_key" value={companyKey} />}
        </div>

        {config?.fields.map(f => (
          <div key={f.column}>
            <label className="label">{f.label}</label>
            <input
              name={`pf_${f.column}`}
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              className="input"
              dir={f.type === 'number' || f.type === 'date' ? 'ltr' : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default PortfolioFieldsSection
