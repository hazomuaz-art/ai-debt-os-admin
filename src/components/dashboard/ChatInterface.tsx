'use client'

import { useState, useMemo } from 'react'
import { Search, Send, Bot, User, Clock, Phone, MessageSquare } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'

interface ChatMessage {
  id: string
  content: string
  direction: 'inbound' | 'outbound'
  channel: string
  status: string
  sent_at: string
  created_at: string
  debt?: {
    reference_number: string
    current_balance?: number
    currency?: string
    customer?: {
      id: string
      full_name: string
      phone: string
      whatsapp?: string
    }
  }
}

interface ChatInterfaceProps {
  initialMessages: ChatMessage[]
}

export function ChatInterface({ initialMessages }: ChatInterfaceProps) {
  const [messages] = useState<ChatMessage[]>(initialMessages)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')

  // Group messages by customer
  const groupedByCustomer = useMemo(() => {
    const map = new Map<string, { customer: any, debt: any, messages: ChatMessage[] }>()
    
    messages.forEach(msg => {
      const cust = msg.debt?.customer
      if (!cust) return
      
      if (!map.has(cust.id)) {
        map.set(cust.id, { customer: cust, debt: msg.debt, messages: [] })
      }
      map.get(cust.id)!.messages.push(msg)
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

  return (
    <div className="flex h-[calc(100vh-160px)] bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" >
      
      {/* ── Sidebar (Chat List) ── */}
      <div className="w-1/3 bg-[#fbfdfd] border-l border-slate-100 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute end-3 top-2.5 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="البحث عن عميل أو رقم..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl pe-10 ps-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#1e3e50]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredCustomers.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">لا توجد محادثات مطابقة</div>
          ) : (
            filteredCustomers.map(item => {
              const lastMsg = item.messages[item.messages.length - 1]
              const isSelected = selectedCustomerId === item.customer.id

              return (
                <div 
                  key={item.customer.id}
                  onClick={() => setSelectedCustomerId(item.customer.id)}
                  className={`p-4 border-b border-slate-50 cursor-pointer transition-colors ${isSelected ? 'bg-[#e6f0f9]' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h4 className="font-bold text-[#1e3e50] text-sm truncate">{item.customer.full_name}</h4>
                    <span className="text-xs text-slate-400 shrink-0">{formatTime(lastMsg.sent_at || lastMsg.created_at)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-slate-500 truncate ps-4">
                      {lastMsg.direction === 'outbound' ? 'Ã¢Å“â€œ ' : ''}{lastMsg.content}
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
      <div className="flex-1 flex flex-col bg-[#eaf0f6] relative">
        {selectedChat ? (
          <>
            {/* Chat Header */}
            <div className="bg-white px-6 py-4 border-b border-slate-100 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#1e3e50] rounded-full flex items-center justify-center text-white">
                  <User size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-[#1e3e50]">{selectedChat.customer.full_name}</h3>
                  <div className="text-xs text-slate-500 flex items-center gap-2">
                    <span>{selectedChat.customer.whatsapp || selectedChat.customer.phone}</span>
                    <span>Ã¢â‚¬Â¢</span>
                    <span className="font-mono text-blue-600 font-semibold">{selectedChat.debt?.reference_number}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-start">
                  <div className="text-xs text-slate-400">المبلغ المستحق</div>
                  <div className="font-bold text-rose-600">
                    {formatCurrency(selectedChat.debt?.current_balance || 0, selectedChat.debt?.currency || 'SAR')}
                  </div>
                </div>
                <button className="p-2 text-slate-400 hover:text-[#1e3e50] bg-slate-50 rounded-full transition-colors">
                  <Phone size={18} />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="text-center mb-6">
                <span className="bg-slate-200/50 text-slate-500 text-xs px-3 py-1 rounded-full">
                  بداية المحادثة
                </span>
              </div>
              
              {selectedChat.messages.map(msg => {
                const isOutbound = msg.direction === 'outbound'
                return (
                  <div key={msg.id} className={`flex ${isOutbound ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                      isOutbound 
                        ? 'bg-white text-[#1e3e50] rounded-tr-sm border border-slate-100 shadow-sm' 
                        : 'bg-[#1e3e50] text-white rounded-tl-sm shadow-md'
                    }`}>
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                      <div className={`text-[10px] mt-1 flex justify-end items-center gap-1 ${isOutbound ? 'text-slate-400' : 'text-blue-200'}`}>
                        {formatTime(msg.sent_at || msg.created_at)}
                        {isOutbound && (
                          <span className="text-[10px]">
                            {msg.status === 'delivered' ? 'Ã¢Å“â€œÃ¢Å“â€œ' : msg.status === 'read' ? 'Ã¢Å“â€œÃ¢Å“â€œ' : 'Ã¢Å“â€œ'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Message Input */}
            <div className="p-4 bg-white border-t border-slate-100">
              <div className="flex items-center gap-2">
                <button className="p-3 text-slate-400 hover:text-rose-500 bg-slate-50 hover:bg-rose-50 rounded-xl transition-colors" title="إيقاف الذكاء الاصطناعي مؤقتاً">
                  <Bot size={20} />
                </button>
                <div className="flex-1 relative">
                  <input 
                    type="text" 
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder="اكتب رسالة للرد المباشر..." 
                    className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl ps-12 pe-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#1e3e50]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && replyText.trim()) {
                        // Dummy send
                        setReplyText('')
                      }
                    }}
                  />
                  <button 
                    className="absolute start-2 top-1.5 p-1.5 bg-[#1e3e50] text-white rounded-lg hover:bg-[#152e3b] transition-colors"
                    onClick={() => setReplyText('')}
                  >
                    <Send size={16} className="transform rotate-180" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare size={48} className="mb-4 opacity-20" />
            <p>اختر محادثة للبدء</p>
          </div>
        )}
      </div>
    </div>
  )
}
