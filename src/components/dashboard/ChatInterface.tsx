'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Send, Bot, User, Phone, MessageSquare } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'
import { AiToggleButton } from '@/components/debt/AiToggleButton'

interface ChatMessage {
  id: string
  content: string
  direction: 'inbound' | 'outbound'
  channel: string
  status: string
  sent_at: string
  created_at: string
  customer?: {
    id: string
    full_name: string
    phone: string
    whatsapp?: string
    ai_paused?: boolean
  }
  debt?: {
    id?: string
    reference_number?: string
    current_balance?: number
    currency?: string
  }
}

interface ChatInterfaceProps {
  initialMessages: ChatMessage[]
}

export function ChatInterface({ initialMessages }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const { t } = useTranslation()
  const m = t.pages.messages
  const router = useRouter()

  // Sync when the server refreshes (new messages / paused state)
  useEffect(() => { setMessages(initialMessages) }, [initialMessages])
  // Auto-refresh the conversation list so new inbound/outbound show without manual reload
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 12000)
    return () => clearInterval(id)
  }, [router])

  // Group messages by customer
  const groupedByCustomer = useMemo(() => {
    const map = new Map<string, { customer: any, debt: any, messages: ChatMessage[] }>()
    
    messages.forEach(msg => {
      const cust = msg.customer
      if (!cust) return

      if (!map.has(cust.id)) {
        map.set(cust.id, { customer: cust, debt: msg.debt ?? null, messages: [] })
      }
      const entry = map.get(cust.id)!
      // keep the most complete debt info we encounter for this customer
      if (msg.debt && (msg.debt.current_balance != null || msg.debt.reference_number)) entry.debt = msg.debt
      entry.messages.push(msg)
    })

    // Sort messages inside each customer and sort customers by latest message
    const list = Array.from(map.values())
    list.forEach(item => {
      item.messages.sort((a, b) => new Date(a.sent_at || a.created_at).getTime() - new Date(b.sent_at || b.created_at).getTime())
    })

    list.sort((a, b) => {
      const lastA = a.messages[a.messages.length - 1]
      const lastB = b.messages[b.messages.length - 1]
      return new Date(lastB.sent_at || lastB.created_at).getTime() - new Date(lastA.sent_at || lastA.created_at).getTime()
    })

    return list
  }, [messages])

  // Filter based on search
  const filteredCustomers = useMemo(() => {
    if (!searchTerm.trim()) return groupedByCustomer
    const term = searchTerm.toLowerCase()
    return groupedByCustomer.filter(item => 
      (item.customer.full_name || '').toLowerCase().includes(term) ||
      (item.customer.phone || '').includes(term) ||
      (item.customer.whatsapp || '').includes(term)
    )
  }, [groupedByCustomer, searchTerm])

  const selectedChat = groupedByCustomer.find(c => c.customer.id === selectedCustomerId)

  // Auto-select first chat if none selected
  if (!selectedCustomerId && filteredCustomers.length > 0) {
    setSelectedCustomerId(filteredCustomers[0].customer.id)
  }

  const formatTime = (dateString?: string) => {
    if (!dateString) return ''
    try {
      return new Date(dateString).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
    } catch (e) {
      return ''
    }
  }

  async function sendReply() {
    const text = replyText.trim()
    const cust = selectedChat?.customer
    if (!text || !cust?.id || sending) return
    const phone = cust.whatsapp || cust.phone
    if (!phone) return
    setSending(true)
    try {
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: text, customer_id: cust.id }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        setReplyText('')
        router.refresh()
      } else {
        alert(typeof d.error === 'string' && /exists"?\s*:\s*false/i.test(d.error) ? 'هذا الرقم غير مسجّل على واتساب' : (d.error || 'تعذّر الإرسال'))
      }
    } catch {
      alert('تعذّر الإرسال، حاول مرة أخرى')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-160px)] bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm overflow-hidden" >
      
      {/* ── Sidebar (Chat List) ── */}
      <div className="w-1/3 bg-[#0d1117] border-l border-[#222a36] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#222a36]">
          <div className="relative">
            <Search className="absolute end-3 top-2.5 text-[#5f6b7e]" size={18} />
            <input 
              type="text" 
              placeholder={m.search_customer}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#0d1117] border-none text-white rounded-xl pe-10 ps-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <div className="p-6 text-center text-[#5f6b7e] text-sm">{m.no_conversations}</div>
          ) : (
            filteredCustomers.map(item => {
              const lastMsg = item.messages[item.messages.length - 1]
              const isSelected = selectedCustomerId === item.customer.id

              return (
                <div 
                  key={item.customer.id}
                  onClick={() => setSelectedCustomerId(item.customer.id)}
                  className={`p-4 border-b border-[#1c2330] cursor-pointer transition-colors ${isSelected ? 'bg-[#0d1117]' : 'hover:bg-[#1a212c]'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-white text-sm truncate">{item.customer.full_name}</h4>
                    <span className="text-xs text-[#5f6b7e] shrink-0">{formatTime(lastMsg.sent_at || lastMsg.created_at)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-[#8b95a7] truncate ps-4">
                      {lastMsg.direction === 'outbound' ? '✓ ' : ''}{lastMsg.content}
                    </p>
                    {lastMsg.direction === 'inbound' && (
                      <div className="w-2 h-2 bg-rose-500 rounded-full shrink-0"></div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col bg-[#0b0e14] relative">
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="bg-[#151a23] px-6 py-4 border-b border-[#222a36] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#0e7a54] rounded-full flex items-center justify-center text-white">
                  <User size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-white">{selectedChat.customer.full_name}</h3>
                  <div className="text-xs text-[#8b95a7] flex items-center gap-2">
                    <span>{selectedChat.customer.whatsapp || selectedChat.customer.phone}</span>
                    {selectedChat.debt?.reference_number && (
                      <>
                        <span>•</span>
                        {selectedChat.debt?.id ? (
                          <Link href={`/dashboard/admin/debts/${selectedChat.debt.id}`} className="font-mono text-blue-400 font-semibold underline decoration-dotted hover:text-blue-300">
                            {selectedChat.debt.reference_number}
                          </Link>
                        ) : (
                          <span className="font-mono text-blue-400 font-semibold">{selectedChat.debt.reference_number}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-start">
                  <div className="text-xs text-[#5f6b7e]">{m.amount_due}</div>
                  <div className="font-bold text-rose-400">
                    {formatCurrency(selectedChat.debt?.current_balance || 0, selectedChat.debt?.currency || 'SAR')}
                  </div>
                </div>
                {selectedChat.customer?.id && (
                  <AiToggleButton customerId={selectedChat.customer.id} paused={!!selectedChat.customer.ai_paused} />
                )}
                <button className="p-2 text-[#5f6b7e] hover:text-white bg-[#222a36] rounded-full transition-colors">
                  <Phone size={18} />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="text-center mb-6">
                <span className="bg-[#222a36] text-[#8b95a7] text-xs px-3 py-1 rounded-full">
                  {m.conversation_start}
                </span>
              </div>
              
              {selectedChat.messages.map(msg => {
                const isOutbound = msg.direction === 'outbound'
                return (
                  <div key={msg.id} className={`flex ${isOutbound ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                      isOutbound 
                        ? 'bg-[#151a23] text-white rounded-tr-sm border border-[#222a36] shadow-sm' 
                        : 'bg-[#0e7a54] text-white rounded-tl-sm shadow-md'
                    }`}>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      <div className={`text-[10px] mt-1 flex justify-end items-center gap-1 ${isOutbound ? 'text-blue-100/70' : 'text-blue-100/80'}`}>
                        {formatTime(msg.sent_at || msg.created_at)}
                        {isOutbound && (
                          <span className="text-[10px]">
                            {msg.status === 'delivered' || msg.status === 'read' ? '✓✓' : '✓'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Message Input */}
            <div className="p-4 bg-[#151a23] border-t border-[#222a36]">
              <div className="flex items-center gap-2">
                <button className="p-3 text-[#5f6b7e] hover:text-rose-400 bg-[#222a36] hover:bg-rose-500/10 rounded-xl transition-colors" title={m.pause_ai}>
                  <Bot size={20} />
                </button>
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={m.write_reply}
                    disabled={sending}
                    className="w-full bg-[#0d1117] border-none text-white rounded-xl ps-12 pe-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54] disabled:opacity-60"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void sendReply() }
                    }}
                  />
                  <button
                    className="absolute start-2 top-1.5 p-1.5 bg-[#0e7a54] text-white rounded-lg hover:bg-[#0b8f63] transition-colors disabled:opacity-50"
                    onClick={() => void sendReply()}
                    disabled={sending || !replyText.trim()}
                  >
                    <Send size={16} className="transform rotate-180" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#5f6b7e]">
            <MessageSquare size={48} className="mb-4 opacity-20" />
            <p>{m.choose_conversation}</p>
          </div>
        )}
      </div>
    </div>
  )
}
