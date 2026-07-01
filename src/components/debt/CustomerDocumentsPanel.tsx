import { Paperclip, Download, AlertTriangle } from 'lucide-react'
import { formatDate } from '@/lib/utils'

// Real gap found during a full-system audit (2026-07-01): inbound WhatsApp
// documents that are NOT payment receipts (ID copies, official letters, any
// other image/PDF the customer sends) were already being classified and
// stored in customer_documents (see waha-webhook route.ts) — but nothing in
// the UI ever read that table. Staff had zero way to see what a customer
// sent unless it happened to be a payment receipt (which has its own column
// on the payments table). This panel is that missing read side, shown on
// every debt detail page (admin/manager/collector) — same table, one place.
export interface CustomerDocumentRow {
  id: string
  doc_type: string | null
  ai_summary: string | null
  needs_admin_review: boolean | null
  storage_path: string | null
  source: string | null
  created_at: string
}

// Mirrors DOCUMENT_TYPES in document-classifier.ts exactly — the closed set
// the classifier is restricted to, so every real value has a label here.
const DOC_TYPE_LABEL: Record<string, string> = {
  receipt: 'إيصال سداد',
  account_statement: 'كشف حساب',
  letter: 'خطاب رسمي',
  court_judgment: 'مستند قضائي',
  proof_of_payment: 'إثبات سداد',
  debt_waiver: 'إسقاط/إعفاء من المديونية',
  id_document: 'هوية وطنية / إقامة',
  other: 'مستند آخر',
}

export default function CustomerDocumentsPanel({ documents }: { documents: CustomerDocumentRow[] }) {
  return (
    <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
      <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-5">
        <Paperclip className="text-amber-500" size={20} />
        <h2 className="text-lg font-bold text-white">مستندات مرسلة من العميل</h2>
        <span className="text-[#5f6b7e] text-xs">({documents.length})</span>
      </div>

      {documents.length === 0 ? (
        <p className="text-[#5f6b7e] text-sm text-center py-6">لا توجد مستندات مرسلة من العميل حتى الآن.</p>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc.id} className="border border-[#222a36] bg-[#222a36]/50 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-white">
                    {DOC_TYPE_LABEL[doc.doc_type ?? 'unknown'] ?? doc.doc_type ?? 'غير مصنّف'}
                  </span>
                  {doc.needs_admin_review && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                      <AlertTriangle size={11} /> يحتاج مراجعة
                    </span>
                  )}
                </div>
                {doc.ai_summary && (
                  <p className="text-[#c5ccd6] text-sm leading-relaxed">{doc.ai_summary}</p>
                )}
                <p className="text-[#5f6b7e] text-xs mt-1">{formatDate(doc.created_at)}</p>
              </div>
              {doc.storage_path && (
                <a
                  href={`/api/customer-documents/${doc.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-bold text-xs"
                >
                  <Download size={13} /> عرض
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
