import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/debts/actions')

// Every Supabase call's error is now checked and logged. Found during a
// full-system audit: every single timeline_events insert in this route used
// an invalid event_type ('promise_made', 'disputed', 'note_added' — none of
// these exist in timeline_events_event_type_check) AND an invalid
// actor_type ('human' — not in timeline_events_actor_type_check, which only
// allows ai/collector/customer/system/campaign). Supabase's JS client never
// throws on a constraint violation, it just returns {error}, and nothing
// here ever checked it — so EVERY manual collector action (promise, dispute,
// handoff, follow-up, note) has silently failed to write to the timeline,
// for every company, since this route was built. The debt-status update
// itself (a separate call) succeeded fine, which is why the visible status
// changed but the timeline entry never appeared.
async function logTimeline(
  supabase: ReturnType<typeof createClient>,
  row: { company_id: string; debt_id: string; event_type: string; summary: string; detail?: string; actor_name: string },
) {
  const { error } = await supabase.from('timeline_events').insert({
    company_id: row.company_id, debt_id: row.debt_id,
    event_type: row.event_type, summary: row.summary, detail: row.detail ?? null,
    actor_type: 'collector', actor_name: row.actor_name, ai_used: false,
  })
  if (error) log.error('timeline_events insert failed', new Error(error.message), { event_type: row.event_type })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { action, amount, date, reason, note, follow_up_date } = await request.json()
    const debtId = params.id

    // Check user auth
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, company_id')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const actorName = profile?.full_name || 'User'

    // Every debt this route can be called for must belong to the caller's
    // own company — without this, any authenticated user from ANY company
    // could mutate another company's debt by guessing/knowing its id.
    const { data: debt, error: debtErr } = await supabase
      .from('debts')
      .select('id, company_id')
      .eq('id', debtId)
      .eq('company_id', profile.company_id)
      .maybeSingle()
    if (debtErr || !debt) {
      return NextResponse.json({ error: 'Debt not found' }, { status: 404 })
    }

    switch (action) {
      case 'promise_to_pay': {
        const { error: pErr } = await supabase.from('promises').insert({
          company_id: profile.company_id,
          debt_id: debtId,
          promised_amount: amount,
          promised_date: date,
          status: 'pending',
          channel: 'manual',
          notes: `مسجل يدوياً بواسطة ${actorName}`
        })
        if (pErr) log.error('manual promise insert failed', new Error(pErr.message), { debtId })

        const { error: dErr } = await supabase.from('debts').update({ status: 'promised' }).eq('id', debtId).eq('company_id', profile.company_id)
        if (dErr) log.error('debt status update (promise) failed', new Error(dErr.message), { debtId })

        await logTimeline(supabase, {
          company_id: profile.company_id, debt_id: debtId, event_type: 'promise_to_pay',
          summary: 'تسجيل وعد بالسداد', detail: `المبلغ الموعود: ${amount}، التاريخ: ${date}`, actor_name: actorName,
        })
        break
      }

      case 'dispute': {
        const { error: dErr } = await supabase.from('debts').update({ status: 'disputed' }).eq('id', debtId).eq('company_id', profile.company_id)
        if (dErr) log.error('debt status update (dispute) failed', new Error(dErr.message), { debtId })

        await logTimeline(supabase, {
          company_id: profile.company_id, debt_id: debtId, event_type: 'status_change',
          summary: 'تسجيل اعتراض من العميل', detail: `السبب: ${reason}`, actor_name: actorName,
        })
        break
      }

      case 'human_handoff': {
        const { error: hErr } = await supabase.from('debts').update({
          status: 'in_progress',
          assigned_to: user.id
        }).eq('id', debtId).eq('company_id', profile.company_id)
        if (hErr) log.error('debt status update (handoff) failed', new Error(hErr.message), { debtId })

        await logTimeline(supabase, {
          company_id: profile.company_id, debt_id: debtId, event_type: 'human_handoff',
          summary: 'تحويل للتدخل البشري', detail: 'تم إيقاف الرد الآلي وتثبيت الملف للمحصل.', actor_name: actorName,
        })
        break
      }

      case 'follow_up': {
        const { error: fErr } = await supabase.from('debts').update({ status: 'in_progress' }).eq('id', debtId).eq('company_id', profile.company_id)
        if (fErr) log.error('debt status update (follow_up) failed', new Error(fErr.message), { debtId })

        await logTimeline(supabase, {
          company_id: profile.company_id, debt_id: debtId, event_type: 'status_change',
          summary: 'إضافة للمتابعة', actor_name: actorName,
        })
        break
      }

      case 'update_note': {
        const updateData: any = {}
        if (note !== undefined) updateData.notes = note
        if (follow_up_date !== undefined) updateData.next_follow_up = follow_up_date

        const { error: nErr } = await supabase.from('debts').update(updateData).eq('id', debtId).eq('company_id', profile.company_id)
        if (nErr) log.error('debt note update failed', new Error(nErr.message), { debtId })

        await logTimeline(supabase, {
          company_id: profile.company_id, debt_id: debtId, event_type: 'collector_note',
          summary: 'تحديث بيانات المتابعة', detail: note, actor_name: actorName,
        })
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in Quick Action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
