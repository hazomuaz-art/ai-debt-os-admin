// Dashboard loading skeleton — shown instantly while the server layout renders.
// This makes every navigation feel immediate — the skeleton appears while
// the profile is being fetched, eliminating the blank-screen delay.
export default function DashboardLoading() {
  return (
    <div className="flex-1 p-6 space-y-5 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-6 w-56 rounded-lg bg-[#222a36]" />
          <div className="h-3.5 w-72 rounded-lg bg-[#222a36]" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded-xl bg-[#222a36]" />
          <div className="h-8 w-24 rounded-xl bg-[#222a36]" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-2xl border border-[#222a36] p-5" style={{ background: 'rgba(22,25,42,0.9)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="h-3 w-24 rounded-md bg-[#222a36]" />
              <div className="h-7 w-7 rounded-xl bg-[#222a36]" />
            </div>
            <div className="h-7 w-36 rounded-lg bg-[#222a36] mb-2" />
            <div className="h-3 w-20 rounded-md bg-[#222a36]" />
          </div>
        ))}
      </div>

      {/* Content rows */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 rounded-2xl border border-[#222a36] p-5 h-48" style={{ background: 'rgba(22,25,42,0.8)' }}>
          <div className="h-4 w-40 rounded-lg bg-[#222a36] mb-4" />
          <div className="h-28 w-full rounded-xl bg-[#222a36]" />
        </div>
        <div className="xl:col-span-2 rounded-2xl border border-[#222a36] p-5 h-48" style={{ background: 'rgba(22,25,42,0.8)' }}>
          <div className="h-4 w-32 rounded-lg bg-[#222a36] mb-4" />
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-full bg-[#222a36]" />
            <div className="flex-1 space-y-3">
              {[0,1,2,3].map(i => <div key={i} className="h-3 rounded-md bg-[#222a36]" style={{ width: `${60+i*10}%` }} />)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {[0,1,2].map(i => (
          <div key={i} className="rounded-2xl border border-[#222a36] p-5 h-52" style={{ background: 'rgba(22,25,42,0.8)' }}>
            <div className="h-4 w-36 rounded-lg bg-[#222a36] mb-4" />
            <div className="space-y-3">
              {[0,1,2,3].map(j => (
                <div key={j} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-xl bg-[#222a36] shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2.5 rounded-md bg-[#222a36]" style={{ width: `${50+j*12}%` }} />
                    <div className="h-2 w-16 rounded-md bg-[#222a36]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
