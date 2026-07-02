'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Loader2, Download, CheckCircle2, XCircle } from 'lucide-react'
import * as XLSX from 'xlsx'

type ImportResults = {
  created: number
  updated: number
  deactivated: number
  reactivated: number
  accounts_created: { name: string; email: string; password: string; portfolio: string | null }[]
  errors: string[]
}

export default function EmployeeImportPanel() {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<ImportResults | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    setResults(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/employees/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setResults(data.data)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل استيراد الملف')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function exportAccounts() {
    if (!results?.accounts_created.length) return
    const rows = results.accounts_created.map(a => ({
      'الاسم': a.name,
      'البريد الإلكتروني (اليوزر)': a.email,
      'كلمة المرور': a.password,
      'المحفظة': a.portfolio ?? '',
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'حسابات المحصلين')
    XLSX.writeFile(wb, `حسابات-محصلين-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-white">رفع ملف الموظفين</h2>
          <p className="text-[#8b95a7] text-sm mt-1">
            ارفع ملف الإكسل نفسه في كل مرة يحدث فيها التحديث. سيتم تحديث بيانات الموظفين الحاليين تلقائياً،
            وتعطيل من لم يعد موجوداً في الملف، وإنشاء حساب دخول منفصل لكل محصل جديد.
          </p>
        </div>
        <label className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#0e7a54] text-white rounded-xl hover:bg-[#0c6647] font-bold text-sm transition-colors cursor-pointer">
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          {uploading ? 'جارٍ الرفع...' : 'اختيار ملف Excel'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
          <XCircle size={16} /> {error}
        </div>
      )}

      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
              <div className="text-[#8b95a7] font-bold text-[10px] mb-1">موظفون جدد</div>
              <div className="font-bold text-emerald-400 text-xl font-mono">{results.created}</div>
            </div>
            <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
              <div className="text-[#8b95a7] font-bold text-[10px] mb-1">تم تحديثهم</div>
              <div className="font-bold text-blue-400 text-xl font-mono">{results.updated}</div>
            </div>
            <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
              <div className="text-[#8b95a7] font-bold text-[10px] mb-1">تم تعطيلهم</div>
              <div className="font-bold text-amber-400 text-xl font-mono">{results.deactivated}</div>
            </div>
            <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
              <div className="text-[#8b95a7] font-bold text-[10px] mb-1">أُعيد تفعيلهم</div>
              <div className="font-bold text-slate-300 text-xl font-mono">{results.reactivated}</div>
            </div>
          </div>

          {results.accounts_created.length > 0 && (
            <div className="bg-[#0b0e14] rounded-xl p-4 border border-[#222a36]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 size={16} /> تم إنشاء {results.accounts_created.length} حساب محصل جديد
                </div>
                <button
                  onClick={exportAccounts}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#0e7a54] text-white rounded-lg hover:bg-[#0c6647] font-bold text-xs transition-colors"
                >
                  <Download size={14} /> تحميل الحسابات (Excel)
                </button>
              </div>
              <p className="text-[#5f6b7e] text-xs">
                جميع الحسابات الجديدة تستخدم نفس كلمة المرور — نزّل الملف وسلّمه للمحصلين مباشرة.
              </p>
            </div>
          )}

          {results.errors.length > 0 && (
            <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
              <div className="text-rose-400 font-bold text-sm mb-2">أخطاء ({results.errors.length})</div>
              <ul className="text-[#8b95a7] text-xs space-y-1 max-h-40 overflow-y-auto font-mono">
                {results.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
