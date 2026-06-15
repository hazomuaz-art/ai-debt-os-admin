'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, UserCog, Loader2 } from 'lucide-react'
import { setCustomerAiPausedAction } from '@/lib/actions/debts'

// Toggles AI auto-reply for a customer. Paused = handed off to a human agent.
export function AiToggleButton({
  customerId,
  paused,
  variant = 'full',
}: {
  customerId: string
  paused: boolean
  variant?: 'full' | 'icon'
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [isPaused, setIsPaused] = useState(paused)

  async function toggle() {
    setLoading(true)
    const next = !isPaused
    const r = await setCustomerAiPausedAction(customerId, next)
    setLoading(false)
    if (!r?.error) {
      setIsPaused(next)
      router.refresh()
    }
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={toggle}
        disabled={loading}
        title={isPaused ? 'الذكاء موقوف — اضغط لإعادة التفعيل' : 'تحويل لموظف (إيقاف الذكاء)'}
        className={`p-2 rounded-lg border transition-colors ${
          isPaused
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
            : 'bg-[#222a36] text-[#8b95a7] border-[#2c3543] hover:text-white'
        }`}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : isPaused ? <UserCog size={16} /> : <Bot size={16} />}
      </button>
    )
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-lg text-xs border transition-colors ${
        isPaused
          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500 hover:text-white'
          : 'bg-[#1a212c] text-slate-300 border-[#2c3543] hover:bg-[#222a36]'
      }`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : isPaused ? <UserCog size={14} /> : <Bot size={14} />}
      {isPaused ? 'يتولّاه موظف' : 'تحويل لموظف'}
    </button>
  )
}

export default AiToggleButton
