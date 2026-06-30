'use client'

import { Printer } from 'lucide-react'

type PrintMessage = {
  id: string
  direction: string
  content: string
  sent_at?: string | null
  created_at?: string | null
  channel?: string | null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Quick "print this conversation" — opens a dedicated print window with
// just the message thread (clean black-on-white, not the app's dark
// theme), instead of trying to hide/show parts of the live dashboard page
// via print CSS, which would be fragile across every debt-detail page's
// different layout. Works the same for admin/manager/collector.
export default function PrintConversationButton({
  customerName,
  debtReference,
  creditorName,
  messages,
}: {
  customerName?: string | null
  debtReference?: string | null
  creditorName?: string | null
  messages: PrintMessage[]
}) {
  function handlePrint() {
    const sorted = [...messages].sort((a, b) =>
      new Date(a.sent_at || a.created_at || 0).getTime() - new Date(b.sent_at || b.created_at || 0).getTime())

    const rows = sorted.map(m => {
      const isOutbound = m.direction === 'outbound'
      const when = new Date(m.sent_at || m.created_at || '').toLocaleString('ar-SA')
      return `
        <div style="display:flex; justify-content:${isOutbound ? 'flex-start' : 'flex-end'}; margin:10px 0;">
          <div style="max-width:70%; padding:10px 14px; border-radius:10px; border:1px solid ${isOutbound ? '#999' : '#ccc'}; background:${isOutbound ? '#fff' : '#f5f5f5'};">
            <div style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(m.content || '')}</div>
            <div style="font-size:11px; color:#666; margin-top:6px; font-family:monospace;">${when} ${m.channel ? '· ' + escapeHtml(m.channel) : ''}</div>
          </div>
        </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>محادثة ${escapeHtml(customerName || '')}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color:#000; background:#fff; padding:24px; }
  h1 { font-size:18px; margin-bottom:4px; }
  .meta { color:#444; font-size:13px; margin-bottom:20px; }
  @media print { body { padding:0; } }
</style>
</head>
<body>
  <h1>محادثة العميل: ${escapeHtml(customerName || '—')}</h1>
  <div class="meta">
    ${creditorName ? `الجهة: ${escapeHtml(creditorName)} — ` : ''}
    ${debtReference ? `الرقم المرجعي: ${escapeHtml(debtReference)} — ` : ''}
    تاريخ الطباعة: ${new Date().toLocaleString('ar-SA')}
  </div>
  ${rows || '<p>لا توجد رسائل لعرضها.</p>'}
</body>
</html>`

    const win = window.open('', '_blank', 'width=800,height=900')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.onload = () => win.print()
    // Some browsers don't reliably fire onload for document.write content —
    // a short fallback timer covers that without delaying browsers that
    // already fired onload (calling print() twice is harmless/no-op).
    setTimeout(() => win.print(), 400)
  }

  return (
    <button
      onClick={handlePrint}
      className="flex items-center gap-1.5 text-xs font-bold text-[#8b95a7] hover:text-white bg-[#222a36] hover:bg-[#2a3340] px-3 py-1.5 rounded-lg border border-[#222a36] transition-colors"
      title="طباعة المحادثة"
    >
      <Printer size={14} /> طباعة المحادثة
    </button>
  )
}
