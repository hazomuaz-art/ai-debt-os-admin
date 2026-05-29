export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-[#05060a] text-white overflow-hidden">
      <section className="relative px-6 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#2563eb55,transparent_35%),radial-gradient(circle_at_80%_20%,#7c3aed55,transparent_30%)]" />

        <div className="relative max-w-7xl mx-auto">
          <nav className="flex items-center justify-between py-4">
            <div>
              <div className="text-2xl font-bold">AI Debt OS</div>
              <div className="text-xs text-white/45">Enterprise AI Collection Platform</div>
            </div>

            <a
              href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Demo Request"
              className="rounded-full bg-white text-black px-5 py-2 text-sm font-bold"
            >
              Contact Sales
            </a>
          </nav>

          <div className="grid lg:grid-cols-2 gap-12 items-center pt-20 pb-28">
            <div>
              <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 mb-6">
                Built for modern collection companies
              </div>

              <h1 className="text-5xl md:text-7xl font-black leading-tight">
                نظام تحصيل ذكي يعمل كفريق كامل
              </h1>

              <p className="mt-6 text-xl text-white/65 leading-relaxed">
                منصة AI Debt OS تساعد شركات التحصيل على إدارة العملاء،
                المديونيات، المحادثات، الوعود، الموافقات، التحليلات، والأتمتة
                من مكان واحد.
              </p>

              <p className="mt-4 text-white/45">
                A complete AI operating system for collection teams: customer
                intelligence, WhatsApp replies, automation, analytics, approvals,
                promises, integrations, and secure enterprise workflows.
              </p>

              <div className="flex flex-wrap gap-4 mt-10">
                <a
                  href="mailto:hazomuaz@gmail.com?subject=Book AI Debt OS Demo"
                  className="rounded-2xl bg-[#5b7cfa] px-7 py-4 font-bold shadow-2xl shadow-blue-600/30"
                >
                  احجز عرض توضيحي
                </a>
                <a
                  href="#features"
                  className="rounded-2xl border border-white/15 px-7 py-4 font-bold text-white/80"
                >
                  Explore Features
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-8 bg-blue-600/20 blur-3xl rounded-full" />

              <div className="relative rounded-3xl border border-white/10 bg-white/8 p-5 shadow-2xl">
                <div className="rounded-2xl bg-[#0b1020] border border-white/10 p-5">
                  <div className="flex gap-2 mb-5">
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                    <span className="w-3 h-3 rounded-full bg-yellow-400" />
                    <span className="w-3 h-3 rounded-full bg-green-400" />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-5">
                    <div className="rounded-xl bg-white/5 p-4">
                      <div className="text-xs text-white/40">AI Impact</div>
                      <div className="text-2xl font-bold text-green-400">+32%</div>
                    </div>
                    <div className="rounded-xl bg-white/5 p-4">
                      <div className="text-xs text-white/40">Promises</div>
                      <div className="text-2xl font-bold">842</div>
                    </div>
                    <div className="rounded-xl bg-white/5 p-4">
                      <div className="text-xs text-white/40">Risk</div>
                      <div className="text-2xl font-bold text-yellow-400">Live</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      ['Customer Context', 'Full history before every reply', 'AI Ready'],
                      ['Payment Claim', 'Receipt requested automatically', 'Review'],
                      ['Installment Request', 'Raised to approval workflow', 'Pending'],
                    ].map((x) => (
                      <div
                        key={x[0]}
                        className="flex items-center justify-between rounded-xl bg-white/5 p-4"
                      >
                        <div>
                          <div className="font-semibold">{x[0]}</div>
                          <div className="text-sm text-white/45">{x[1]}</div>
                        </div>
                        <div className="text-xs rounded-full bg-blue-500/20 text-blue-300 px-3 py-1">
                          {x[2]}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="absolute -right-5 top-10 rounded-2xl bg-white text-black p-4 shadow-xl">
                <div className="font-bold">AI Agent</div>
                <div className="text-sm text-black/60">Natural Saudi replies</div>
              </div>

              <div className="absolute -left-5 bottom-10 rounded-2xl bg-[#111827] border border-white/10 p-4 shadow-xl">
                <div className="font-bold">Secure</div>
                <div className="text-sm text-white/50">Private customer data</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-24 bg-white/[0.03]">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black text-center">
            كل ما تحتاجه شركات التحصيل في منصة واحدة
          </h2>
          <p className="text-center text-white/50 mt-4">
            Everything collection teams need to automate, analyze, and recover more.
          </p>

          <div className="grid md:grid-cols-3 gap-5 mt-14">
            {[
              ['AI Conversations', 'إدارة محادثات طويلة مع فهم تاريخ العميل بالكامل', 'Long customer conversations with full history.'],
              ['Collection Actions', 'خطط يومية ذكية لأفضل إجراءات التحصيل', 'Daily AI-powered collection actions.'],
              ['Approvals', 'طلبات التقسيط والتسويات تذهب للمراجعة', 'Human approval for sensitive decisions.'],
              ['Promises', 'متابعة وعود السداد والتنبيه عند التأخير', 'Promise tracking and missed commitment alerts.'],
              ['Analytics', 'تحليلات للإنتاجية والتحصيل والأداء', 'Real-time performance and recovery insights.'],
              ['AI Memory', 'ذاكرة لكل عميل تشمل الإفادات والمحادثات', 'Customer memory across messages and events.'],
            ].map(([title, ar, en]) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-black/30 p-7">
                <div className="w-12 h-12 rounded-2xl bg-blue-600/20 mb-5 flex items-center justify-center">
                  <span className="w-5 h-5 rounded-full bg-blue-400" />
                </div>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="mt-3 text-white/65">{ar}</p>
                <p className="mt-2 text-sm text-white/35">{en}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-black">
              تكامل مع أنظمة التحصيل المختلفة
            </h2>
            <p className="mt-5 text-white/60 text-lg">
              النظام غير محصور في مزود واحد. يمكن ربطه مع أنظمة التحصيل،
              مزودي واتساب، مراكز الاتصال، أنظمة الدفع، CRM، أو أي API خارجي.
            </p>
            <p className="mt-3 text-white/40">
              Connect any collection system, WhatsApp provider, call center,
              CRM, payment gateway, or custom API.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {['Collection Systems', 'WhatsApp Providers', 'Call Centers', 'CRM', 'Payment Systems', 'Custom APIs'].map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-5 font-semibold">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-white/[0.03]">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
            {[
              'Company data isolation',
              'Role-based access control',
              'Secure customer records',
              'Audit-ready activity tracking',
              'Human approval for sensitive actions',
              'Privacy-first customer communication',
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 py-4 border-b border-white/5 last:border-0">
                <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-300">
                  ✓
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div>
            <h2 className="text-4xl md:text-5xl font-black">
              أمان وخصوصية على مستوى الشركات
            </h2>
            <p className="mt-5 text-white/60 text-lg">
              مصمم لحماية بيانات العملاء، فصل بيانات الشركات، التحكم في الصلاحيات،
              وتسجيل النشاطات لضمان الشفافية والحوكمة.
            </p>
            <p className="mt-3 text-white/40">
              Enterprise-grade architecture for sensitive collection operations.
            </p>
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto rounded-[2rem] border border-white/10 bg-gradient-to-br from-blue-700/30 to-purple-700/20 p-10 md:p-16 text-center">
          <h2 className="text-4xl md:text-5xl font-black">
            ارفع إنتاجية التحصيل بدون زيادة فريق العمل
          </h2>
          <p className="mt-5 text-white/65 max-w-3xl mx-auto text-lg">
            منصة واحدة تساعد الإدارة والمحصلين على فهم العملاء، متابعة الوعود،
            تحليل المحادثات، ورفع جودة التحصيل بشكل واضح.
          </p>

          <a
            id="contact"
            href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Sales Inquiry"
            className="inline-flex mt-10 rounded-2xl bg-white text-black px-8 py-4 font-black"
          >
            Contact Sales
          </a>

          <div className="mt-6 text-white/50">
            Email: hazomuaz@gmail.com • Riyadh, Saudi Arabia
          </div>
        </div>
      </section>

      <footer className="px-6 py-10 border-t border-white/10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between gap-4 text-sm text-white/40">
          <div>© 2026 AI Debt OS. Enterprise AI Collection Platform.</div>
          <div>Privacy • Security • Integrations • Contact</div>
        </div>
      </footer>
    </main>
  )
}