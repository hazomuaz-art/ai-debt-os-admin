import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { runAudit, type AuditStatus, type AuditItem } from '@/lib/auditor'
import { getRecentRuns, getRunStats } from '@/lib/orchestrator'
import TriggerBatchButton from './TriggerBatchButton'

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AuditStatus }) {
  const cfg: Record<AuditStatus, { label: string; bg: string; text: string }> = {
    working:           { label: 'Working',            bg: 'rgba(16,185,129,0.12)', text: '#34d399' },
    partial:           { label: 'Partial',            bg: 'rgba(245,158,11,0.12)', text: '#fbbf24' },
    broken:            { label: 'Broken',             bg: 'rgba(239,68,68,0.12)',  text: '#f87171' },
    not_connected:     { label: 'Not Connected',      bg: 'rgba(99,102,241,0.12)', text: '#818cf8' },
    needs_credentials: { label: 'Needs Credentials',  bg: 'rgba(139,92,246,0.12)', text: '#a78bfa' },
    empty:             { label: 'Empty',              bg: 'rgba(255,255,255,0.05)','text': 'rgba(255,255,255,0.4)' },
  }
  const c = cfg[status]
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      {c.label}
    </span>
  )
}

// ── Health score ring ─────────────────────────────────────────────────────────

function HealthRing({ score }: { score: number }) {
  const r     = 42
  const circ  = 2 * Math.PI * r
  const dash  = circ - (score / 100) * circ
  const color = score >= 80 ? '#34d399' : score >= 55 ? '#fbbf24' : '#f87171'

  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dash} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-2xl text-slate-900">{score}%</span>
        <span className="text-[9px] text-[#8b95a7] uppercase tracking-wider">Health</span>
      </div>
    </div>
  )
}

// ── Module card ───────────────────────────────────────────────────────────────

function ModuleRow({ item }: { item: AuditItem }) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-xl transition-colors"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border:     '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="text-sm font-medium text-slate-300">{item.name}</span>
          <StatusBadge status={item.status} />
        </div>
        <p className="text-xs text-[#8b95a7] leading-relaxed">{item.detail}</p>
        {item.fix && (
          <p className="text-xs mt-1" style={{ color: '#818cf8' }}>
            💡 {item.fix}
          </p>
        )}
      </div>
      {item.row_count !== undefined && (
        <div className="shrink-0 text-start">
          <div className="font-mono text-sm font-bold text-[#8b95a7]">{item.row_count.toLocaleString()}</div>
          <div className="text-[9px] text-white/25">rows</div>
        </div>
      )}
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, items, emoji }: { title: string; items: AuditItem[]; emoji: string }) {
  if (!items.length) return null
  const working = items.filter(i => i.status === 'working').length
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">{emoji} {title}</h2>
        <span className="text-xs text-[#8b95a7]">{working}/{items.length} working</span>
      </div>
      <div className="space-y-2">
        {items.map((item: AuditItem, i: number) => <div key={i}><ModuleRow item={item} /></div>)}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SystemHealthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/admin')

  const cid = profile.company_id

  // Run audit and load run stats in parallel
  const [report, runs, stats] = await Promise.all([
    runAudit(cid, false),
    getRecentRuns(cid, 15),
    getRunStats(cid),
  ])

  const scoreColor =
    report.health_score >= 80 ? '#34d399' :
    report.health_score >= 55 ? '#fbbf24' : '#f87171'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-900">System Health</h1>
          <p className="text-[#8b95a7] text-sm mt-0.5">
            AI System Orchestrator &amp; Auditor — {report.generated_at.slice(0, 19).replace('T', ' ')} UTC
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/api/auditor?safe_fix=true">
            <button className="btn-secondary text-xs px-3 py-2">🔧 Apply Safe Fixes</button>
          </Link>
          <Link href="/api/orchestrator">
            <button className="btn-secondary text-xs px-3 py-2">📊 Run History JSON</button>
          </Link>
          <TriggerBatchButton />
        </div>
      </div>

      {/* Health overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="card p-5 flex flex-col items-center gap-2 xl:col-span-1">
          <HealthRing score={report.health_score} />
          <div className="text-xs text-[#8b95a7] text-center">Overall</div>
        </div>

        {([
          { label: 'Working',           value: report.working,           color: '#34d399' },
          { label: 'Partial',           value: report.partial,           color: '#fbbf24' },
          { label: 'Broken',            value: report.broken,            color: '#f87171' },
          { label: 'Not Connected',     value: report.not_connected,     color: '#818cf8' },
          { label: 'Needs Credentials', value: report.needs_credentials, color: '#a78bfa' },
        ] as Array<{ label: string; value: number; color: string }>).map(({ label, value, color }) => (
          <div key={label} className="stat-card flex flex-col justify-center">
            <div className="font-display font-bold text-2xl" style={{ color }}>{value}</div>
            <div className="text-[11px] text-[#8b95a7] mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Orchestrator stats */}
      <div className="card p-5">
        <h2 className="section-title mb-4">Orchestrator Activity</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          {([
            { label: 'Total Runs',    value: stats.total,        color: '#818cf8' },
            { label: 'Today',         value: stats.today,        color: '#22d3ee' },
            { label: 'Failed',        value: stats.failed,       color: '#f87171' },
            { label: 'Success Rate',  value: `${stats.success_rate}%`, color: '#34d399' },
          ] as Array<{ label: string; value: string | number; color: string }>).map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="font-mono font-bold text-xl" style={{ color }}>{value}</div>
              <div className="text-xs text-[#8b95a7] mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Recent runs */}
        {runs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#5f6b7e] text-end border-b border-[#222a36]">
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Mode</th>
                  <th className="pb-2 font-medium">Score</th>
                  <th className="pb-2 font-medium">Actions</th>
                  <th className="pb-2 font-medium">Alerts</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {(runs as Array<Record<string, unknown>>).map(run => (
                  <tr key={String(run.id)} className="border-b border-[#222a36] hover:bg-[#1a212c]">
                    <td className="py-2 pe-4 font-mono text-[#8b95a7]">{String(run.event_source ?? '').replace('_',' ')}</td>
                    <td className="py-2 pe-4 text-[#8b95a7]">{String(run.mode ?? '—')}</td>
                    <td className="py-2 pe-4" style={{ color: '#818cf8' }}>{run.ai_score != null ? String(run.ai_score) : '—'}</td>
                    <td className="py-2 pe-4 text-[#8b95a7]">{String(run.ai_actions_count ?? 0)}</td>
                    <td className="py-2 pe-4 text-[#8b95a7]">{String(run.alerts_count ?? 0)}</td>
                    <td className="py-2 pe-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        run.success
                          ? 'bg-green-500/10 text-green-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}>
                        {run.success ? '✓' : '✗'} {run.success ? 'OK' : String(run.error_message ?? 'Error').slice(0, 25)}
                      </span>
                    </td>
                    <td className="py-2 pe-4 text-[#5f6b7e] font-mono">{run.duration_ms != null ? `${run.duration_ms}ms` : '—'}</td>
                    <td className="py-2 text-[#5f6b7e]">{String(run.created_at ?? '').slice(11, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-white/25 text-sm">
            No orchestrator runs yet. Import a CSV or click{' '}
            <Link href="/dashboard/admin/automation" className="text-brand-400 hover:text-brand-300">
              Automation → Trigger Batch
            </Link>
          </div>
        )}
      </div>

      {/* Audit sections */}
      <Section title="Pipeline Modules"   items={report.summary.pipeline}     emoji="⚡" />
      <Section title="Module Connections" items={report.summary.modules}      emoji="🔗" />
      <Section title="Integrations"       items={report.summary.integrations}  emoji="🔌" />
      <Section title="Database Tables"    items={report.summary.tables}       emoji="🗄️" />
      <Section title="API Routes"         items={report.summary.api_routes}   emoji="🛣" />
      <Section title="Dashboard Pages"    items={report.summary.pages}        emoji="📄" />

      {/* Safe fixes applied */}
      {report.safe_fixes_applied?.length && (
        <div className="card p-5" style={{ borderColor: 'rgba(16,185,129,0.2)' }}>
          <h2 className="section-title mb-3" style={{ color: '#34d399' }}>Safe Fixes Applied</h2>
          <ul className="space-y-1">
            {report.safe_fixes_applied.map((fix: string, i: number) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-green-400 mt-0.5">✓</span>{fix}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer note */}
      <div className="text-center pb-4">
        <p className="text-xs text-[#5f6b7e]">
          Auditor reads data only — no changes unless you click "Apply Safe Fixes".
          Health score: {report.total_checks} checks · {report.working} working · {report.broken} broken.
        </p>
      </div>
    </div>
  )
}






