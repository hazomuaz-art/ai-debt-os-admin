const photos = {
  hero: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1600&q=90",
  team: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=90",
  executive: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=90",
  operations: "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1600&q=90",
}

const modules = [
  ["AI Conversations", "محادثات ذكية طويلة مع العملاء مع فهم السياق السابق."],
  ["AI Memory", "ذاكرة لكل عميل تشمل الإفادات، المحادثات، الوعود، والملاحظات."],
  ["AI Actions", "خطة يومية تقترح أفضل إجراء لكل عميل."],
  ["Promises", "تتبع وعود السداد والتنبيه عند عدم الالتزام."],
  ["Approvals", "طلبات التقسيط والتسويات تذهب للإدارة للمراجعة."],
  ["Campaigns", "حملات متابعة ذكية حسب حالة العميل والمحفظة."],
  ["Analytics", "لوحات قياس للإنتاجية والتحصيل والأداء."],
  ["Portfolios", "إدارة المحافظ والمشاريع وأنواع المديونيات."],
  ["Rules & Automation", "قواعد تلقائية لتقليل العمل اليدوي والتكاليف."],
  ["Integrations", "الربط مع أنظمة التحصيل، واتساب، CRM، مراكز الاتصال، والدفع."],
  ["AI Voice Ready", "بنية جاهزة لمكالمات AI مستقبلية بعد ربط مزود الاتصال."],
  ["Security", "عزل بيانات الشركات، صلاحيات، وسجل نشاطات."],
]

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-[#07111f] text-slate-900 overflow-hidden">
      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_5%,#2563eb55,transparent_35%),radial-gradient(circle_at_90%_10%,#14b8a644,transparent_30%)]" />

        <div className="relative max-w-7xl mx-auto px-6 py-7">
          <nav className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-black tracking-tight">AI Debt OS</div>
              <div className="text-xs text-white/45">Enterprise Collection Intelligence Platform</div>
            </div>

            <div className="hidden md:flex items-center gap-7 text-sm text-slate-500">
              <a href="#modules">Modules</a>
              <a href="#impact">Impact</a>
              <a href="#security">Security</a>
              <a href="#integrations">Integrations</a>
            </div>

            <a
              href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Demo Request"
              className="rounded-full bg-white text-black px-5 py-2 text-sm font-bold"
            >
              Contact Sales
            </a>
          </nav>

          <div className="grid lg:grid-cols-2 gap-14 items-center py-24">
            <div>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-600 mb-6">
                Built for collection companies and enterprise recovery teams
              </div>

              <h1 className="text-4xl md:text-6xl font-black leading-tight tracking-tight">
                نظام تشغيل ذكي لشركات التحصيل
              </h1>

              <p className="mt-6 text-xl text-slate-600 leading-relaxed">
                AI Debt OS يساعد شركات التحصيل على رفع الإنتاجية، إدارة آلاف العملاء،
                فهم تاريخ كل عميل، متابعة الوعود، وتحويل العمليات اليدوية إلى تشغيل
                ذكي مدعوم بالذكاء الاصطناعي.
              </p>

              <p className="mt-4 text-white/45 leading-relaxed">
                A complete enterprise platform for collection operations:
                customer intelligence, AI conversations, automation, approvals,
                analytics, portfolios, and secure integrations.
              </p>

              <div className="flex flex-wrap gap-4 mt-9">
                <a
                  href="mailto:hazomuaz@gmail.com?subject=Book AI Debt OS Demo"
                  className="rounded-2xl bg-[#3b82f6] px-8 py-4 font-black shadow-2xl shadow-blue-600/30"
                >
                  احجز عرض توضيحي
                </a>
                <a
                  href="#modules"
                  className="rounded-2xl border border-slate-200 px-8 py-4 font-bold text-white/85"
                >
                  استكشف النظام
                </a>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-10">
                {["AI", "Automation", "Analytics"].map((x) => (
                  <div key={x} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-lg font-black">{x}</div>
                    <div className="text-xs text-slate-500">Enterprise ready</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-8 rounded-full bg-blue-500/20 blur-3xl" />
              <img
                src={photos.hero}
                alt="AI Debt OS enterprise collection team"
                className="relative w-full h-[560px] object-cover rounded-[2rem] border border-slate-200 shadow-2xl"
              />

              <div className="absolute left-6 bottom-6 right-6 rounded-3xl bg-[#08111f]/85 backdrop-blur border border-slate-200 p-5">
                <div className="text-sm text-white/45 mb-3">Live collection command center</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Customers</div>
                    <div className="text-2xl font-black">360°</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">AI Actions</div>
                    <div className="text-2xl font-black text-blue-300">Live</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Security</div>
                    <div className="text-2xl font-black text-green-300">On</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="impact" className="px-6 py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <img src={photos.team} alt="Collection operations team" className="rounded-[2rem] border border-slate-200 shadow-2xl h-[520px] w-full object-cover" />

          <div>
            <h2 className="text-4xl md:text-5xl font-black">
              مصمم لزيادة التحصيل وتقليل العمل اليدوي
            </h2>
            <p className="mt-6 text-white/65 text-lg leading-relaxed">
              النظام لا يعمل كشات بوت فقط، بل يعمل كمنصة تشغيل كاملة تجمع بيانات
              العملاء، المديونيات، المحادثات، الإفادات، الوعود، التنبيهات، والتحليلات
              في مكان واحد.
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mt-8">
              {[
                "رفع إنتاجية المحصلين",
                "تقليل وقت البحث عن بيانات العميل",
                "توحيد المحادثات والإفادات",
                "متابعة وعود السداد تلقائياً",
                "تقليل الأخطاء التشغيلية",
                "وضوح كامل للإدارة",
              ].map((x) => (
                <div key={x} className="rounded-2xl bg-slate-50 border border-slate-200 p-5 font-bold">
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="modules" className="px-6 py-24">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-black">Platform Modules</h2>
            <p className="mt-5 text-white/55 text-lg">
              كل الوحدات التي تحتاجها شركة التحصيل لتشغيل العمليات، متابعة العملاء،
              مراقبة الأداء، وربط الأنظمة المختلفة.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 mt-14">
            {modules.map(([title, desc]) => (
              <div key={title} className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-6 hover:bg-slate-50 transition">
                <div className="w-11 h-11 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-5">
                  <span className="w-4 h-4 rounded-full bg-blue-300" />
                </div>
                <h3 className="text-xl font-black">{title}</h3>
                <p className="mt-3 text-white/55 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <h2 className="text-4xl md:text-5xl font-black">How AI Debt OS Works</h2>
            <p className="mt-5 text-slate-500 text-lg">
              من لحظة ربط نظام التحصيل، يبدأ AI Debt OS في تنظيم البيانات، تحليل
              العملاء، اقتراح الإجراءات، وتسجيل كل تفاعل داخل Timeline وAI Memory.
            </p>

            <div className="space-y-4 mt-8">
              {[
                ["01", "Connect", "ربط نظام التحصيل أو CRM أو أي API خارجي."],
                ["02", "Sync", "مزامنة العملاء، المديونيات، الحالات، والمحافظ."],
                ["03", "Analyze", "تحليل البيانات وتحديد الأولويات والفرص."],
                ["04", "Act", "اقتراح إجراءات، متابعة وعود، وتنبيهات للإدارة."],
                ["05", "Measure", "قياس الإنتاجية، الأداء، ونتائج التحصيل."],
              ].map(([n, title, desc]) => (
                <div key={n} className="flex gap-4 rounded-2xl bg-slate-50 border border-slate-200 p-5">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center font-black text-blue-300">
                    {n}
                  </div>
                  <div>
                    <div className="font-black text-lg">{title}</div>
                    <div className="text-white/55">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <img src={photos.operations} alt="AI collection operations" className="rounded-[2rem] border border-slate-200 shadow-2xl h-[620px] w-full object-cover" />
        </div>
      </section>

      <section id="security" className="px-6 py-24">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
          <img src={photos.executive} alt="Executive analytics and security review" className="rounded-[2rem] border border-slate-200 shadow-2xl h-[520px] w-full object-cover" />

          <div>
            <h2 className="text-4xl md:text-5xl font-black">Security, Privacy & Governance</h2>
            <p className="mt-6 text-white/65 text-lg leading-relaxed">
              لأن بيانات التحصيل حساسة، النظام مصمم حول الخصوصية، الصلاحيات،
              عزل بيانات الشركات، وسجل النشاطات. القرارات الحساسة مثل التقسيط
              والتسوية تبقى تحت مراجعة الإدارة.
            </p>

            <div className="space-y-3 mt-8">
              {[
                "Company data isolation",
                "Role-based user permissions",
                "Audit-ready activity tracking",
                "Human approval for sensitive decisions",
                "Secure integration architecture",
              ].map((x) => (
                <div key={x} className="flex items-center gap-3 rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <span className="w-7 h-7 rounded-full bg-green-500/20 text-green-300 flex items-center justify-center">✓</span>
                  <span>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="integrations" className="px-6 py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-black">Works with your existing systems</h2>
          <p className="mt-5 text-white/55 text-lg max-w-3xl mx-auto">
            لا نحصر النظام في مزود واحد. يمكن ربطه مع أنظمة التحصيل، مزودي واتساب،
            مراكز الاتصال، أنظمة الدفع، CRM، أو أي API مخصص.
          </p>

          <div className="grid md:grid-cols-3 gap-5 mt-14">
            {["Collection Systems", "WhatsApp Providers", "Call Centers", "CRM Platforms", "Payment Systems", "Custom APIs"].map((x) => (
              <div key={x} className="rounded-3xl bg-[#08111f] border border-slate-200 p-8">
                <div className="text-2xl font-black">{x}</div>
                <div className="mt-3 text-white/45">Integration ready</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24">
        <div className="max-w-7xl mx-auto rounded-[2.5rem] bg-gradient-to-br from-blue-700/40 to-cyan-700/20 border border-slate-200 p-10 md:p-16 text-center">
          <h2 className="text-4xl md:text-6xl font-black">
            جاهز تحول عمليات التحصيل إلى نظام ذكي؟
          </h2>
          <p className="mt-6 text-slate-600 text-xl max-w-3xl mx-auto">
            احجز عرض توضيحي وشوف كيف AI Debt OS يساعد شركتك على تحسين الإنتاجية،
            تنظيم العملاء، وتحقيق رؤية أوضح لعمليات التحصيل.
          </p>

          <a
            href="mailto:hazomuaz@gmail.com?subject=AI Debt OS Sales Inquiry"
            className="inline-flex mt-10 rounded-2xl bg-white text-black px-10 py-5 font-black"
          >
            Contact Sales
          </a>

          <div className="mt-6 text-slate-500">hazomuaz@gmail.com • Riyadh, Saudi Arabia</div>
        </div>
      </section>

      <footer className="px-6 py-10 border-t border-slate-200">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between gap-4 text-sm text-slate-500">
          <div>© 2026 AI Debt OS. Enterprise Collection Intelligence Platform.</div>
          <div>Security • Privacy • Integrations • Contact</div>
        </div>
      </footer>
    </main>
  )
}
