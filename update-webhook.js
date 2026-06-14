const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'app', 'api', 'whatsapp', 'webhook', 'route.ts')
let content = fs.readFileSync(filePath, 'utf8')

const targetOld = `            // Process AI decision and reply asynchronously to prevent webhook timeouts
            ;(async () => {
              const aiDecision = await generateWhatsappOperationalDecision({
                company_id: (customer as { company_id: string }).company_id,
                customer_id: (customer as { id: string }).id,
                debt_id: (latestDebt as { id: string } | null)?.id ?? null,
                message: text,
              })

              processEvent({
                source: 'webhook_evolution',
                company_id: (customer as { company_id: string }).company_id,
                _customer_id: (customer as { id: string }).id,
                _debt_id: (latestDebt as { id: string } | null)?.id,
                data: {
                  message: text,
                  from: phoneRaw,
                  message_id: String(evo.data.key.id ?? ''),
                  ai_next_action: aiDecision.nextAction,
                  ai_system_impact: aiDecision.systemImpact,
                },
              }).catch(() => {})

              const autoReply = aiDecision.reply

              if (autoReply) {
                // Human-like typing delay (2 to 6 seconds)
                const delayMs = Math.floor(Math.random() * 4000) + 2000
                await new Promise(r => setTimeout(r, delayMs))

                const sendResult = await sendWhatsAppMessage({ 
                  to: phoneRaw, 
                  message: autoReply,
                  company_id: (customer as { company_id: string }).company_id
                })

                await supabase.from('messages').insert({
                  company_id: (customer as { company_id: string }).company_id,
                  customer_id: (customer as { id: string }).id,
                  debt_id: (latestDebt as { id: string } | null)?.id ?? null,
                  channel: 'whatsapp',
                  direction: 'outbound',
                  content: autoReply,
                  status: sendResult.status === 'sent' ? 'sent' : 'failed',
                  whatsapp_message_id: sendResult.message_id ?? null,
                  sent_at: new Date().toISOString(),
                  metadata: { provider: 'evolution_ai_auto_reply', error: sendResult.error ?? null },
                })
              }
            })().catch(err => log.error('AI Reply Background Processing Error', err))`

const targetNew = `            // Route to n8n for AI processing as requested
            ;(async () => {
              const { getN8nClient } = await import('@/lib/n8n/client')
              const n8nClient = getN8nClient()
              const company_id = (customer as { company_id: string }).company_id
              const customer_id = (customer as { id: string }).id
              const debt_id = (latestDebt as { id: string } | null)?.id ?? undefined

              log.info('Delegating AI processing to n8n webhook', { company_id, customer_id, debt_id })

              await n8nClient.triggerAIAnalysis({
                company_id,
                customer_id,
                debt_id,
                message: text,
                instance_name: evo.instance,
                conversation_id: phoneRaw
              })
            })().catch(err => log.error('n8n AI Webhook Trigger Error', err))`

content = content.replace(targetOld, targetNew)

fs.writeFileSync(filePath, content, 'utf8')
console.log('Update Complete')
