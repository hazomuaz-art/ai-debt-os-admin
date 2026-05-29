const heroImage =
  "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1400&q=80"

const opsImage =
  "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80"

const executiveImage =
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=80"

const features = [
  ["AI Customer Context", "يعرف تاريخ العميل قبل أي رد", "Full customer history before every response"],
  ["Smart Conversations", "محادثات طويلة بدون فقدان السياق", "Long conversations with memory"],
  ["AI Actions", "اقتراح أفضل إجراء لكل حالة", "Next-best-action recommendations"],
  ["Promises & Approvals", "وعود السداد وطلبات المراجعة", "Promises, approvals, and follow-up"],
  ["Analytics", "لوحات قياس للإنتاجية والتحصيل", "Operational and recovery analytics"],
  ["Secure Integrations", "ربط مع أي نظام تحصيل أو واتساب أو CRM", "Connect any collection stack"],
]

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-[#060812] text-white overflow-hidden">
      <section className="relative min-h-screen px-6 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,#2563eb55,transparent_35%),radial-gradient(circle_at_80%_0%,#7c3aed44,transparent_30%)]" />

        <div className="relative max-w-7xl mx-auto">
          <nav className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-black">AI Debt OS</div>
              <div className="text-xs text-white/45">Enterprise Collection Intelligence</div>
            </div>
            <a href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Demo" className="rounded-full bg-white text-black px-5 py-2 text-sm font-bold">
              Contact Sales
            </a>
          </nav>

          <div className="grid lg:grid-cols-2 gap-14 items-center pt-24">
            <div>
              <div className="inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm text-white/70 mb-7">
                Built for collection companies, telecom, insurance, and recovery teams
              </div>

              <h1 className="text-5xl md:text-7xl font-black leading-[1.05] tracking-tight">
                Enterprise AI Platform for Modern Collections
              </h1>

              <p className="mt-7 text-2xl text-white/70 leading-relaxed">
                نظام ذكاء اصطناعي يساعد شركات التحصيل على رفع الإنتاجية، فهم العميل، إدارة المحادثات، وتقليل الجهد اليدوي من منصة واحدة.
              </p>

              <div className="flex flex-wrap gap-4 mt-10">
                <a href="mailto:hazomuaz@gmail.com?subject=Book AI Debt OS Demo" className="rounded-2xl bg-blue-500 px-8 py-4 font-black shadow-2xl shadow-blue-600/30">
                  احجز عرض توضيحي
                </a>
                <a href="#features" className="rounded-2xl border border-white/15 px-8 py-4 font-bold text-white/80">
                  Explore Platform
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-10 bg-blue-500/20 blur-3xl rounded-full" />
              <img src={heroImage} alt="AI Debt OS enterprise dashboard" className="relative rounded-[2rem] border border-white/10 shadow-2xl object-cover h-[520px] w-full" />
              <div className="absolute -bottom-8 -left-8 rounded-3xl bg-white text-black p-6 shadow-2xl hidden md:block">
                <div className="text-sm text-black/50">AI Impact</div>
                <div className="text-4xl font-black">Live</div>
                <div className="text-sm text-black/60">Context + Automation + Analytics</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-24 bg-white/[0.03]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-4xl md:text-6xl font-black">Built like a full collection operation</h2>
            <p className="mt-5 text-white/55 text-lg">
              AI Debt OS combines customer intelligence, automation, approvals, analytics, and secure integrations.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-16">
            {features.map(([title, ar, en]) => (
              <div key={title} className="rounded-[2rem] border border-white/10 bg-black/40 p-7 hover:bg-white/5 transition">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/20 mb-6 flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full bg-blue-400 animate-pulse" />
                </div>
                <h3 className="text-2xl font-black">{title}</h3>
                <p className="mt-3 text-white/70">{ar}</p>
                <p className="mt-2 text-sm text-white/35">{en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <img src={opsImage} alt="Collection operations team" className="rounded-[2rem] border border-white/10 shadow-2xl object-cover h-[520px] w-full" />
          <div>
            <h2 className="text-4xl md:text-6xl font-black">From scattered follow-up to intelligent operations</h2>
            <p className="mt-6 text-white/65 text-xl leading-relaxed">
              النظام يربط العملاء، المديونيات، المحادثات، الإفادات، الوعود، والموافقات في مسار تشغيلي واحد يساعد الإدارة والمحصلين على اتخاذ القرار الصحيح.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-8">
              {["Reduce manual work", "Improve recovery visibility", "Centralize customer history", "Automate follow-up"].map((x) => (
                <div key={x} className="rounded-2xl bg-white/5 border border-white/10 p-5 font-bold">
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-white/[0.03]">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <h2 className="text-4xl md:text-6xl font-black">Enterprise security and privacy</h2>
            <p className="mt-6 text-white/65 text-xl leading-relaxed">
              مصمم للبيانات الحساسة: عزل بيانات الشركات، صلاحيات المستخدمين، سجل النشاطات، وموافقات بشرية للقرارات الحساسة مثل التقسيط والتسوية.
            </p>
            <div className="space-y-4 mt-8">
              {["Company data isolation", "Role-based access", "Audit-ready activity logs", "Human approval controls", "Privacy-first customer communication"].map((x) => (
                <div key={x} className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-4">
                  <span className="w-7 h-7 rounded-full bg-green-500/20 text-green-300 flex items-center justify-center">✓</span>
                  <span>{x}</span>
                </div>
              ))}
            </div>
          </div>
          <img src={executiveImage} alt="Executive analytics review" className="rounded-[2rem] border border-white/10 shadow-2xl object-cover h-[520px] w-full" />
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl font-black">Connect your existing collection stack</h2>
          <p className="mt-5 text-white/55 text-lg">
            AI Debt OS is not limited to one provider. Connect collection systems, WhatsApp providers, call centers, CRMs, payment systems, or custom APIs.
          </p>

          <div className="grid md:grid-cols-3 gap-5 mt-14">
            {["Collection Systems", "WhatsApp Providers", "Call Centers", "CRM Platforms", "Payment Systems", "Custom APIs"].map((x) => (
              <div key={x} className="rounded-3xl border border-white/10 bg-black/40 p-8 text-2xl font-black">
                {x}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto rounded-[2.5rem] bg-gradient-to-br from-blue-700/40 to-purple-700/30 border border-white/10 p-12 md:p-20 text-center">
          <h2 className="text-4xl md:text-6xl font-black">Ready to transform your collection operations?</h2>
          <p className="mt-6 text-white/70 text-xl max-w-3xl mx-auto">
            احجز عرض توضيحي وشوف كيف AI Debt OS يقدر يحول التحصيل من متابعة يدوية إلى تشغيل ذكي مدعوم بالذكاء الاصطناعي.
          </p>
          <a href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Sales Inquiry" className="inline-flex mt-10 rounded-2xl bg-white text-black px-10 py-5 font-black">
            Contact Sales
          </a>
          <div className="mt-6 text-white/50">hazomuaz@gmail.com • Riyadh, Saudi Arabia</div>
        </div>
      </section>

      <footer className="px-6 py-10 border-t border-white/10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between gap-4 text-sm text-white/40">
          <div>© 2026 AI Debt OS. Enterprise AI Collection Platform.</div>
          <div>Security • Privacy • Integrations • Contact</div>
        </div>
      </footer>
    </main>
  )
}
