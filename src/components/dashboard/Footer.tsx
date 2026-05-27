export function DashboardFooter() {
  return (
    <footer
      className="mt-8 mx-0 px-6 py-4 border-t"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {/* Trust indicators row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {[
          { icon: '🔒', label: 'Enterprise Security' },
          { icon: '🛡', label: 'Secure Session' },
          { icon: '🤖', label: 'AI Monitoring' },
          { icon: '🔐', label: 'Encrypted Platform' },
          { icon: '⚡', label: 'Real-time Protection' },
        ].map(({ icon, label }) => (
          <div
            key={label}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-white/30"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <span className="text-xs">{icon}</span>
            {label}
          </div>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {/* Compliance marks */}
          {[
            { label: 'ISO 27001', sub: 'Certified' },
            { label: 'SOC 2', sub: 'Compliant' },
            { label: 'GDPR', sub: 'Compliant' },
            { label: 'AES-256', sub: 'Encrypted' },
          ].map(({ label, sub }) => (
            <div key={label} className="flex items-center gap-1 text-[9px] text-white/20">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-white/30">{label}</div>
                <div>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Copyright row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 2px 8px rgba(79,70,229,0.4)' }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <span className="text-xs font-bold text-white/50">AI</span>
            <span className="text-xs font-bold" style={{ color: '#818cf8' }}> DEBT OS</span>
            <span className="text-[10px] text-white/20 ml-2">® Smarter Collections. Healthier Cashflow.</span>
          </div>
        </div>

        <div className="text-[11px] text-white/25 text-right">
          <div>© 2025 AI Debt OS. All rights reserved.</div>
          <div dir="rtl" className="text-white/15">جميع الحقوق محفوظة</div>
        </div>
      </div>
    </footer>
  )
}
