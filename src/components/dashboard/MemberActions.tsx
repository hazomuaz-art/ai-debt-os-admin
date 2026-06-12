'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Power, Settings2, Shield, XCircle } from 'lucide-react'

export function MemberActions({ 
  memberId, 
  currentRole, 
  isActive, 
  currentUserId 
}: { 
  memberId: string, 
  currentRole: string, 
  isActive: boolean, 
  currentUserId: string 
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [editingRole, setEditingRole] = useState(false)

  const isSelf = memberId === currentUserId

  async function toggleStatus() {
    if (isSelf) return
    setLoading(true)
    try {
      const res = await fetch(`/api/platform/users/${memberId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive })
      })
      if (res.ok) router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function updateRole(newRole: string) {
    if (isSelf || newRole === currentRole) return
    setLoading(true)
    try {
      const res = await fetch(`/api/platform/users/${memberId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      })
      if (res.ok) {
        setEditingRole(false)
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between w-full mt-4 pt-4 border-t border-slate-100">
      
      {/* Active Status Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleStatus}
          disabled={loading || isSelf}
          className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${
            isSelf ? 'opacity-50 cursor-not-allowed bg-slate-50 text-slate-400' :
            isActive 
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 group' 
              : 'bg-white text-slate-500 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200'
          }`}
        >
          <Power size={14} className={isActive && !isSelf ? 'group-hover:hidden' : ''} />
          {isActive && !isSelf && <XCircle size={14} className="hidden group-hover:block" />}
          {isActive ? (
            <span className={!isSelf ? 'group-hover:hidden' : ''}>نشط</span>
          ) : (
            <span>غير نشط</span>
          )}
          {isActive && !isSelf && <span className="hidden group-hover:block">إيقاف</span>}
          {!isActive && !isSelf && <span>(تفعيل)</span>}
        </button>
      </div>

      {/* Role Editor */}
      <div className="relative">
        {!editingRole ? (
          <button 
            onClick={() => !isSelf && setEditingRole(true)}
            disabled={isSelf}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              isSelf ? 'text-slate-400 cursor-not-allowed' : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
            }`}
          >
            <Settings2 size={14} /> تعديل الصلاحية
          </button>
        ) : (
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200 absolute left-0 bottom-0 min-w-max z-10 animate-in fade-in zoom-in-95">
            <select 
              className="text-xs border-none bg-white rounded-md py-1 px-2 font-bold text-slate-700 focus:ring-1 focus:ring-blue-500"
              defaultValue={currentRole}
              onChange={(e) => updateRole(e.target.value)}
              disabled={loading}
              dir="rtl"
            >
              <option value="admin">مدير نظام</option>
              <option value="manager">مشرف تحصيل</option>
              <option value="collector">موظف تحصيل</option>
            </select>
            <button 
              onClick={() => setEditingRole(false)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <XCircle size={14} />
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
