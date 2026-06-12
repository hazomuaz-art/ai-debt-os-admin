'use client'

import { Search, Bell, Moon, Sun } from 'lucide-react'

export function Topbar({ profile }: { profile: any }) {
  const name = profile?.full_name?.split(' ')[0] || 'المدير'

  return (
    <header className="bg-[#f0f4f8] pt-8 pb-4 px-8 flex justify-between items-center shrink-0 z-10">
      <div className="flex-1">
        <h1 className="text-2xl font-bold text-[#1e3e50] tracking-tight">مرحباً بك {name} !</h1>
      </div>
      
      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute right-4 top-2.5 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search" 
            className="w-full bg-white border border-slate-200 text-slate-700 rounded-full pr-12 pl-4 py-2 text-sm focus:outline-none focus:border-[#1e3e50] shadow-sm"
          />
        </div>
      </div>
      
      <div className="flex-1 flex justify-end items-center gap-4">
        {/* Toggle switch like in image */}
        <div className="flex items-center bg-[#1e3e50] rounded-full p-1 shadow-inner">
          <button className="p-1.5 rounded-full bg-white text-[#1e3e50] shadow-sm">
            <Sun size={14} className="fill-current" />
          </button>
          <button className="p-1.5 rounded-full text-slate-400 hover:text-white transition-colors">
            <Moon size={14} className="fill-current" />
          </button>
        </div>
        <button className="relative p-2 text-slate-600 hover:text-[#1e3e50] bg-white rounded-full shadow-sm border border-slate-100">
          <Bell size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
        </button>
      </div>
    </header>
  )
}
