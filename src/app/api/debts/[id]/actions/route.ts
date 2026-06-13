import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      .select('full_name')
      .eq('id', user.id)
      .single()
      
    const actorName = profile?.full_name || 'User'

    switch (action) {
      case 'promise_to_pay':
        // 1. Insert into promises
        await supabase.from('promises').insert({
          debt_id: debtId,
          promised_amount: amount,
          promised_date: date,
          status: 'pending',
          channel: 'manual',
          notes: `مسجل يدوياً بواسطة ${actorName}`
        })
        
        // 2. Update debt status to promised
        await supabase.from('debts').update({ status: 'promised' }).eq('id', debtId)
        
        // 3. Log to timeline
        await supabase.from('timeline_events').insert({
          debt_id: debtId,
          event_type: 'promise_made',
          summary: 'تسجيل وعد بالسداد',
          detail: `المبلغ الموعود: ${amount}، التاريخ: ${date}`,
          actor_type: 'human',
          actor_name: actorName,
          ai_used: false
        })
        break

      case 'dispute':
        // 1. Update debt status to disputed
        await supabase.from('debts').update({ status: 'disputed' }).eq('id', debtId)
        
        // 2. Log to timeline
        await supabase.from('timeline_events').insert({
          debt_id: debtId,
          event_type: 'disputed',
          summary: 'تسجيل اعتراض من العميل',
          detail: `السبب: ${reason}`,
          actor_type: 'human',
          actor_name: actorName,
          ai_used: false
        })
        break

      case 'human_handoff':
        // 1. Update status or metadata
        await supabase.from('debts').update({ 
          status: 'in_progress',
          assigned_to: user.id
        }).eq('id', debtId)
        
        // 2. Log to timeline
        await supabase.from('timeline_events').insert({
          debt_id: debtId,
          event_type: 'human_handoff',
          summary: 'تحويل للتدخل البشري',
          detail: 'تم إيقاف الرد الآلي وتثبيت الملف للمحصل.',
          actor_type: 'human',
          actor_name: actorName,
          ai_used: false
        })
        break

      case 'follow_up':
        // 1. Just mark as in_progress
        await supabase.from('debts').update({ status: 'in_progress' }).eq('id', debtId)
        
        // 2. Log to timeline
        await supabase.from('timeline_events').insert({
          debt_id: debtId,
          event_type: 'status_change',
          summary: 'إضافة للمتابعة',
          actor_type: 'human',
          actor_name: actorName,
          ai_used: false
        })
        break

      case 'update_note':
        // Update the debt record directly
        const updateData: any = {}
        if (note !== undefined) updateData.notes = note
        if (follow_up_date !== undefined) updateData.next_follow_up = follow_up_date
        
        await supabase.from('debts').update(updateData).eq('id', debtId)
        
        // Log to timeline
        await supabase.from('timeline_events').insert({
          debt_id: debtId,
          event_type: 'note_added',
          summary: 'تحديث بيانات المتابعة',
          detail: note,
          actor_type: 'human',
          actor_name: actorName,
          ai_used: false
        })
        break

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in Quick Action:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
