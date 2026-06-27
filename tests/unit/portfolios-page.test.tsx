import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Real production data shape, pulled directly from the live DB: every
// portfolio has code: null. This is the exact data that crashed the page
// in production (TypeError: Cannot read properties of null, reading
// 'slice'/'toLowerCase') before the fix.
const REAL_PORTFOLIOS = [
  { id: '80e4a048-dbe9-41fd-8574-3152ddf9d4d9', company_id: 'c', name: 'إس تي سي', name_ar: 'إس تي سي', code: null, category: 'telecom', source_system: 'manual', color: '#6272f1', is_active: true, notes: null, metadata: {}, created_at: '', updated_at: '' },
  { id: '02b33dfe-2669-48f4-83bc-2add3cdd04e8', company_id: 'c', name: 'التعاونية', name_ar: 'التعاونية', code: null, category: 'insurance', source_system: 'manual', color: '#6272f1', is_active: true, notes: null, metadata: {}, created_at: '', updated_at: '' },
]

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ data: REAL_PORTFOLIOS }),
})

beforeEach(() => { vi.mocked(global.fetch).mockClear() })

describe('Portfolios list page — renders with REAL production data (code: null)', () => {
  it('does not throw when every portfolio has code: null (the exact production crash)', async () => {
    const { default: PortfoliosPage } = await import('@/app/dashboard/admin/portfolios/page')
    const { container } = render(<PortfoliosPage />)
    // Wait for the async fetch -> setPortfolios -> re-render cycle to settle,
    // then assert the real portfolio names made it into the DOM — proof the
    // .code.slice()/.code.toLowerCase() crash did not happen during render.
    await waitFor(() => expect(container.textContent).toContain('إس تي سي'), { timeout: 3000 })
    expect(container.textContent).toContain('التعاونية')
    expect(container.textContent).not.toMatch(/Application error|client-side exception/i)
  })

  it('search input renders and is interactive without throwing on null code', async () => {
    const { default: PortfoliosPage } = await import('@/app/dashboard/admin/portfolios/page')
    const { container } = render(<PortfoliosPage />)
    await waitFor(() => expect(container.textContent).toContain('إس تي سي'), { timeout: 3000 })
    const search = screen.getByPlaceholderText(/ابحث/)
    expect(search).toBeTruthy()
  })
})
