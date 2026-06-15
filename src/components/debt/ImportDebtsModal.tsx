'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, X, FileText, CheckCircle, AlertCircle, Download } from 'lucide-react'

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export default function ImportDebtsModal() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith('.csv') && !f.name.toLowerCase().endsWith('.xlsx') && !f.name.toLowerCase().endsWith('.xls')) {
      setError('Only CSV or Excel files are supported')
      return
    }
    setFile(f)
    setError('')
    setResult(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleImport() {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/debts/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Import failed')
      } else {
        setResult(data.data)
        if (data.data.imported > 0) router.refresh()
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function downloadTemplate() {
    const csv = [
      'Customer Name,Phone,WhatsApp,National ID,City,Employer,Monthly Income,Amount,Current Balance,Currency,Due Date,Status,Priority,Product Type,Account Number,Notes',
      'Ahmed Al-Rashid,+966501234567,+966501234567,1234567890,Riyadh,Saudi Aramco,15000,50000,,SAR,2025-12-31,active,high,Personal Loan,ACC-001,Previous customer',
      'Fatima Hassan,+966509876543,,9876543210,Jeddah,,8000,25000,20000,SAR,2025-06-30,active,medium,Credit Card,,',
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'debt_import_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleClose() {
    setOpen(false)
    setFile(null)
    setResult(null)
    setError('')
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary flex items-center gap-2">
        <Upload className="w-4 h-4" /> Import CSV
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-lg font-semibold font-syne">Import Debts from CSV</h2>
                <p className="text-[#5f6b7e] text-sm mt-0.5">Bulk import customers and debts</p>
              </div>
              <button onClick={handleClose}><X className="w-5 h-5 text-[#5f6b7e] hover:text-white" /></button>
            </div>

            {!result ? (
              <>
                {/* Drop zone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => inputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                    file ? 'border-brand-500 bg-brand-500/5' : 'border-[#222a36] hover:border-[#222a36]'
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                  {file ? (
                    <div className="flex flex-col items-center gap-2">
                      <FileText className="w-10 h-10 text-brand-400" />
                      <p className="font-medium text-slate-900">{file.name}</p>
                      <p className="text-[#5f6b7e] text-sm">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-10 h-10 text-[#8b95a7]" />
                      <p className="text-slate-300">Drop your CSV here or click to browse</p>
                      <p className="text-[#8b95a7] text-xs">Max 10MB</p>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                {/* Column reference */}
                <div className="mt-4 p-3 bg-[#222a36] rounded-lg">
                  <p className="text-xs text-[#5f6b7e] mb-2">Required columns: <span className="text-slate-900">Name, Amount</span></p>
                  <p className="text-xs text-[#8b95a7]">
                    Optional: Phone, WhatsApp, National ID, City, Employer, Monthly Income, Current Balance, Currency, Due Date, Status, Priority, Product Type, Account Number, Notes
                  </p>
                </div>

                <div className="mt-4 flex gap-3">
                  <button onClick={downloadTemplate} className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm">
                    <Download className="w-4 h-4" /> Template
                  </button>
                  <button
                    onClick={handleImport}
                    disabled={!file || loading}
                    className="btn-primary flex-1 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-[#222a36] border-t-white rounded-full animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" /> Import
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              /* Results */
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <CheckCircle className="w-8 h-8 text-green-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-green-400">{result.imported} debts imported</p>
                    {result.skipped > 0 && (
                      <p className="text-[#5f6b7e] text-sm">{result.skipped} rows skipped</p>
                    )}
                  </div>
                </div>

                {result.errors.length > 0 && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm font-medium mb-2">Errors ({result.errors.length})</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {result.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-300">{e}</p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => { setFile(null); setResult(null) }} className="btn-secondary flex-1">
                    Import Another
                  </button>
                  <button onClick={handleClose} className="btn-primary flex-1">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

