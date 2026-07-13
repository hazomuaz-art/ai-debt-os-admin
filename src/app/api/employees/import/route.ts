import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { resolveCompanyProfile } from '@/lib/company-import-profiles'
import { createLogger } from '@/lib/logger'
import { parseSheet, type ParsedRow } from '@/lib/employees-import-parser'
import crypto from 'crypto'

const log = createLogger('api/employees/import')

const TRACKED_FIELDS: (keyof ParsedRow)[] = [
  'full_name', 'branch', 'supervisor_name', 'job_title', 'portfolio_name',
  'work_phone', 'pbx_server', 'pbx_extension', 'pbx_connection_key',
]

const COLLECTOR_TITLE_RE = /محصل/

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!file || !(file instanceof File)) return errors.badRequest('file is required')

      const buf = await file.arrayBuffer()
      let rows: ParsedRow[]
      try {
        rows = parseSheet(buf)
      } catch (err) {
        return errors.badRequest('Failed to parse Excel file: ' + (err instanceof Error ? err.message : String(err)))
      }
      if (!rows.length) return errors.badRequest('No valid employee rows found in file')

      const svc = ctx.serviceClient
      const companyId = ctx.profile.company_id

      const { data: existingRows, error: existingErr } = await svc
        .from('employees').select('*').eq('company_id', companyId)
      if (existingErr) return errors.internal(existingErr.message)
      const existingByEmail = new Map<string, any>((existingRows ?? []).map((e: any) => [e.email, e]))

      const { data: portfolios } = await svc
        .from('portfolios').select('id, name, name_ar').eq('company_id', companyId)

      function resolvePortfolioId(rawName: string | null): string | null {
        if (!rawName || !portfolios?.length) return null
        const profile = resolveCompanyProfile(rawName)
        const canonical = profile?.nameAr ?? rawName
        const match = portfolios.find((p: any) =>
          p.name === rawName || p.name_ar === rawName || p.name === canonical || p.name_ar === canonical)
        return match?.id ?? null
      }

      const seenEmails = new Set<string>()
      const results = { created: 0, updated: 0, deactivated: 0, reactivated: 0, accounts_created: [] as { name: string; email: string; password: string; portfolio: string | null }[], errors: [] as string[] }

      const sharedPassword = process.env.DEFAULT_COLLECTOR_PASSWORD || crypto.randomBytes(6).toString('base64url')

      for (const row of rows) {
        seenEmails.add(row.email)
        try {
          const portfolio_id = resolvePortfolioId(row.portfolio_name)
          const existing = existingByEmail.get(row.email)

          if (!existing) {
            const { data: created, error: createErr } = await svc.from('employees').insert({
              company_id: companyId, email: row.email, full_name: row.full_name,
              branch: row.branch, supervisor_name: row.supervisor_name, job_title: row.job_title,
              portfolio_name: row.portfolio_name, portfolio_id,
              work_phone: row.work_phone, pbx_server: row.pbx_server,
              pbx_extension: row.pbx_extension, pbx_connection_key: row.pbx_connection_key,
              status: 'active', last_synced_at: new Date().toISOString(),
            }).select('id').single()
            if (createErr || !created) { results.errors.push(`${row.email}: ${createErr?.message ?? 'insert failed'}`); continue }

            const { error: histCreatedErr } = await svc.from('employee_history').insert({
              employee_id: created.id, change_type: 'created', new_value: row.full_name,
            })
            if (histCreatedErr) log.error('employee_history insert failed (created)', new Error(histCreatedErr.message), { email: row.email })
            results.created++

            if (row.job_title && COLLECTOR_TITLE_RE.test(row.job_title)) {
              const { data: authUser, error: authErr } = await svc.auth.admin.createUser({
                email: row.email, password: sharedPassword, email_confirm: true,
                user_metadata: { full_name: row.full_name, role: 'collector' },
              })
              if (authErr || !authUser?.user) {
                results.errors.push(`${row.email}: account creation failed — ${authErr?.message ?? 'unknown'}`)
              } else {
                const { error: profErr } = await svc.from('profiles').update({
                  company_id: companyId, role: 'collector', full_name: row.full_name,
                  phone: row.work_phone, is_active: true,
                }).eq('id', authUser.user.id)
                if (profErr) {
                  log.error('profile setup failed after auto-provisioning collector account', new Error(profErr.message), { email: row.email })
                } else {
                  const { error: linkErr } = await svc.from('employees').update({ profile_id: authUser.user.id }).eq('id', created.id)
                  if (linkErr) log.error('employees.profile_id link update failed', new Error(linkErr.message), { email: row.email })
                  results.accounts_created.push({ name: row.full_name, email: row.email, password: sharedPassword, portfolio: row.portfolio_name })
                }
              }
            }
          } else {
            const changedFields: string[] = []
            const updatePayload: Record<string, unknown> = {}
            for (const f of TRACKED_FIELDS) {
              if ((existing as any)[f] !== row[f]) {
                changedFields.push(f)
                updatePayload[f] = row[f]
              }
            }
            if ((existing as any).portfolio_id !== portfolio_id) {
              changedFields.push('portfolio_id')
              updatePayload.portfolio_id = portfolio_id
            }
            const wasInactive = existing.status === 'inactive'
            if (wasInactive) updatePayload.status = 'active'

            if (changedFields.length || wasInactive) {
              updatePayload.last_synced_at = new Date().toISOString()
              updatePayload.updated_at = new Date().toISOString()
              const { error: updErr } = await svc.from('employees').update(updatePayload).eq('id', existing.id)
              if (updErr) { results.errors.push(`${row.email}: ${updErr.message}`); continue }

              for (const f of changedFields) {
                const { error: histUpdErr } = await svc.from('employee_history').insert({
                  employee_id: existing.id,
                  change_type: wasInactive && f === changedFields[0] ? 'reactivated' : 'updated',
                  field_changed: f, old_value: String((existing as any)[f] ?? ''), new_value: String((row as any)[f] ?? portfolio_id ?? ''),
                })
                if (histUpdErr) log.error('employee_history insert failed (updated)', new Error(histUpdErr.message), { email: row.email, field: f })
              }
              if (wasInactive) results.reactivated++
              else results.updated++
            }
          }
        } catch (err) {
          results.errors.push(`${row.email}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      for (const existing of existingRows ?? []) {
        if (existing.status === 'active' && !seenEmails.has(existing.email)) {
          const { error: deactErr } = await svc.from('employees').update({
            status: 'inactive', last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
          if (deactErr) { results.errors.push(`${existing.email}: deactivation failed — ${deactErr.message}`); continue }
          const { error: histDeactErr } = await svc.from('employee_history').insert({ employee_id: existing.id, change_type: 'deactivated' })
          if (histDeactErr) log.error('employee_history insert failed (deactivated)', new Error(histDeactErr.message), { email: existing.email })
          if (existing.profile_id) {
            const { error: deactProfileErr } = await svc.from('profiles').update({ is_active: false }).eq('id', existing.profile_id)
            if (deactProfileErr) log.error('profile deactivation failed for removed employee', new Error(deactProfileErr.message), { email: existing.email })
          }
          results.deactivated++
        }
      }

      log.info('employee import completed', { ...results, accounts_created: results.accounts_created.length })
      return NextResponse.json({ data: results })
    },
    { requiredRoles: ['admin'] }
  )
}
