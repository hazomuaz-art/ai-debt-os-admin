import { createLogger } from '@/lib/logger'

const log = createLogger('audio-transcription')

// WhatsApp voice notes arrive via WAHA as audio/ogg (opus codec) almost
// always — OpenAI's Whisper API accepts ogg/mp3/wav/m4a directly, no local
// conversion needed. Uses the direct OpenAI API (not OpenRouter, which only
// proxies chat completions, not the audio/transcriptions endpoint).
export async function transcribeAudioMessage(base64: string, mimetype: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) {
    log.warn('OPENAI_API_KEY not configured — cannot transcribe voice notes')
    return null
  }
  try {
    const OpenAI = (await import('openai')).default
    const { toFile } = await import('openai/uploads')
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const ext = mimetype.includes('ogg') ? 'ogg'
      : mimetype.includes('mp3') || mimetype.includes('mpeg') ? 'mp3'
      : mimetype.includes('wav') ? 'wav'
      : mimetype.includes('m4a') || mimetype.includes('mp4') ? 'm4a'
      : 'ogg'
    const file = await toFile(Buffer.from(base64, 'base64'), `voice.${ext}`)

    // No `language` param pinned — Whisper auto-detects. This platform
    // already serves non-Arabic-speaking customers (expat workers) for
    // typed text (see isNonArabicMessage in ai-collector-agent.ts); voice
    // notes need the same openness, not an assumption everyone speaks Arabic.
    const result = await client.audio.transcriptions.create({ file, model: 'whisper-1' })
    const transcript = result.text?.trim()
    return transcript || null
  } catch (err) {
    log.error('audio transcription failed', err as Error, { mimetype })
    return null
  }
}
