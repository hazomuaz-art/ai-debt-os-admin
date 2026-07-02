'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { QrCode, Loader2, LogOut, CheckCircle2, XCircle } from 'lucide-react'

type NumberRow = {
  id: string
  display_name: string | null
  phone_number: string
  instance_name: string
  is_active: boolean
  daily_limit: number
  portfolio?: { name: string; name_ar: string | null } | null
}

// Real gap found during a full-system audit: the backend for connecting a
// portfolio WhatsApp number (QR pairing via WAHA, same mechanism as WhatsApp
// Web) was fully built (GET/POST/DELETE /api/portfolio-whatsapp-numbers/
// connect) but had ZERO UI anywhere in the app calling it — completely
// unreachable. This component is the missing frontend half.
export default function WhatsAppNumberCard({ number }: { number: NumberRow }) {
  const [state, setState] = useState<'checking' | 'open' | 'close'>('checking')
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${number.id}`)
      const data = await res.json()
      setState(data?.state === 'open' ? 'open' : 'close')
    } catch {
      setState('close')
    }
  }, [number.id])

  useEffect(() => {
    checkStatus()
    // Poll while a QR is showing (waiting for the phone to scan) or right
    // after a connect attempt, so the card flips to "connected" on its own
    // once the customer's phone actually scans it — no manual refresh needed.
    const interval = setInterval(checkStatus, qr ? 4000 : 20000)
    return () => clearInterval(interval)
  }, [checkStatus, qr])

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio-whatsapp-numbers/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: number.id }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'فشل توليد رمز QR')
      setQr(data.base64)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الاتصال')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('هل تريد فصل هذا الرقم؟ لن يستطيع استقبال أو إرسال رسائل بعدها.')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portfolio-whatsapp-numbers/connect?id=${number.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'فشل الفصل')
      setQr(null)
      await checkStatus()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الفصل')
    } finally {
      setLoading(false)
    }
  }

  // Once connected, drop the QR modal automatically.
  useEffect(() => {
    if (state === 'open' && qr) setQr(null)
  }, [state, qr])

  return (
    <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm overflow-hidden">
      <div className="p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-white">{number.display_name || number.portfolio?.name_ar || number.portfolio?.name || 'رقم واتساب'}</span>
            {state === 'checking' ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-[#222a36] text-[#8b95a7]">
                <Loader2 size={11} className="animate-spin" /> جاري الفحص
              </span>
            ) : state === 'open' ? (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 size={11} /> متصل
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                <XCircle size={11} /> غير متصل
              </span>
            )}
          </div>
          <p className="text-[#8b95a7] text-xs font-mono" dir="ltr">{number.phone_number} · {number.instance_name}</p>
          <p className="text-[#5f6b7e] text-xs mt-0.5">المحفظة: {number.portfolio?.name_ar || number.portfolio?.name || '—'}</p>
        </div>

        <div className="shrink-0 flex gap-2">
          {state === 'open' ? (
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} فصل
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#0e7a54] text-white hover:bg-[#0c6647] disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />} ربط عبر QR
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-5 pb-3 text-rose-400 text-xs">{error}</p>}

      {qr && (
        <div className="border-t border-[#222a36] bg-[#0d1117] p-6 flex flex-col items-center gap-3">
          <p className="text-slate-200 text-sm font-bold">افتح واتساب على جوال هذا الرقم ← الأجهزة المرتبطة ← مسح الرمز</p>
          <img src={qr} alt="WhatsApp QR" className="w-56 h-56 rounded-xl border border-[#222a36]" />
          <p className="text-[#5f6b7e] text-xs">تُحدَّث الحالة تلقائياً بمجرد المسح، لا تحتاج تحديث الصفحة.</p>
        </div>
      )}
    </div>
  )
}
