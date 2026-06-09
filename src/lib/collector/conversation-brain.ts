import OpenAI from 'openai'

export type ConversationTurn = {
  direction: 'inbound' | 'outbound'
  content: string
}

export type CollectorBrainInput = {
  message: string
  history: ConversationTurn[]
}
export type CollectorBrainOutput = {
  shouldReply: boolean
  reply: string
  intent: string
  action: string
  confidence: number
}
export async function runCollectorConversationBrain(
  input: CollectorBrainInput
): Promise<CollectorBrainOutput> {
  const message = input.message.trim()

  if (!message) {
    return {
      shouldReply: false,
      reply: '',
      intent: 'empty',
      action: 'silent',
      confidence: 1,
    }
  }

  return {
    shouldReply: true,
    reply: 'تم استلام رسالتك، بنراجع الملف ونرد عليك.',
    intent: 'basic_reply',
    action: 'reply',
    confidence: 0.5,
  }
}