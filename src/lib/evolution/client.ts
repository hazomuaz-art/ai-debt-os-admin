// AI Debt OS — Evolution API Client
// Multi-instance WhatsApp management via Evolution API

type EvolutionInstance = {
  instanceName: string
  apiUrl: string
  apiKey: string
}

type SendMessageParams = {
  number: string // phone number with country code (e.g. 966501234567)
  text?: string
  mediaUrl?: string
  mediaType?: 'image' | 'video' | 'audio' | 'document'
  fileName?: string
  caption?: string
}

type SendTemplateParams = {
  number: string
  templateName: string
  language: string
  components?: Record<string, unknown>[]
}

type EvolutionResponse = {
  success: boolean
  messageId?: string
  status?: string
  data?: Record<string, unknown>
  error?: string
}

type InstanceStatus = {
  instanceName: string
  state: 'open' | 'close' | 'connecting'
  phoneNumber?: string
  profileName?: string
  profilePicUrl?: string
}

type QRCodeResponse = {
  pairingCode?: string
  code?: string
  base64?: string
}

class EvolutionClient {
  private instance: EvolutionInstance

  constructor(instance: EvolutionInstance) {
    this.instance = instance
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.instance.apiKey,
    }
  }

  private async request(path: string, method: string = 'GET', body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.instance.apiUrl}${path}`

    try {
      const response = await fetch(url, {
        method,
        headers: this.headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      return await response.json()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Evolution] ${method} ${path} error: ${message}`)
      throw error
    }
  }

  // ── Instance Management ──

  /**
   * Get instance connection status
   */
  async getStatus(): Promise<InstanceStatus> {
    const data = await this.request(`/instance/connectionState/${this.instance.instanceName}`)
    return data as unknown as InstanceStatus
  }

  /**
   * Get QR code for connecting WhatsApp
   */
  async getQRCode(): Promise<QRCodeResponse> {
    const data = await this.request(`/instance/connect/${this.instance.instanceName}`)
    return data as unknown as QRCodeResponse
  }

  /**
   * Disconnect/logout instance
   */
  async disconnect(): Promise<void> {
    await this.request(`/instance/logout/${this.instance.instanceName}`, 'DELETE')
  }

  /**
   * Restart instance
   */
  async restart(): Promise<void> {
    await this.request(`/instance/restart/${this.instance.instanceName}`, 'PUT')
  }

  // ── Messaging ──

  /**
   * Send a text message
   */
  async sendText(params: { number: string; text: string }): Promise<EvolutionResponse> {
    try {
      const data = await this.request(
        `/message/sendText/${this.instance.instanceName}`,
        'POST',
        {
          number: params.number,
          text: params.text,
        }
      )

      return {
        success: true,
        messageId: (data as Record<string, Record<string, string>>).key?.id,
        status: 'sent',
        data,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      }
    }
  }

  /**
   * Send a media message (image, video, audio, document)
   */
  async sendMedia(params: SendMessageParams): Promise<EvolutionResponse> {
    try {
      const data = await this.request(
        `/message/sendMedia/${this.instance.instanceName}`,
        'POST',
        {
          number: params.number,
          mediatype: params.mediaType || 'image',
          media: params.mediaUrl,
          fileName: params.fileName,
          caption: params.caption,
        }
      )

      return {
        success: true,
        messageId: (data as Record<string, Record<string, string>>).key?.id,
        status: 'sent',
        data,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Send failed',
      }
    }
  }

  /**
   * Send message (auto-detect type)
   */
  async send(params: SendMessageParams): Promise<EvolutionResponse> {
    if (params.mediaUrl) {
      return this.sendMedia(params)
    }
    if (params.text) {
      return this.sendText({ number: params.number, text: params.text })
    }
    return { success: false, error: 'No content to send' }
  }

  // ── Contact ──

  /**
   * Check if a number has WhatsApp
   */
  async checkNumber(number: string): Promise<{ exists: boolean; jid?: string }> {
    try {
      const data = await this.request(
        `/chat/whatsappNumbers/${this.instance.instanceName}`,
        'POST',
        { numbers: [number] }
      )
      const results = data as unknown as Array<{ exists: boolean; jid: string }>
      return results[0] || { exists: false }
    } catch {
      return { exists: false }
    }
  }

  /**
   * Get profile picture
   */
  async getProfilePic(number: string): Promise<string | null> {
    try {
      const data = await this.request(
        `/chat/fetchProfilePictureUrl/${this.instance.instanceName}`,
        'POST',
        { number }
      )
      return (data as Record<string, string>).profilePictureUrl || null
    } catch {
      return null
    }
  }
}

// ── Multi-Instance Manager ──

class EvolutionManager {
  private instances: Map<string, EvolutionClient> = new Map()

  /**
   * Register an Evolution API instance
   */
  register(instanceName: string, apiUrl: string, apiKey: string): EvolutionClient {
    const client = new EvolutionClient({ instanceName, apiUrl, apiKey })
    this.instances.set(instanceName, client)
    return client
  }

  /**
   * Get a registered instance client
   */
  get(instanceName: string): EvolutionClient | undefined {
    return this.instances.get(instanceName)
  }

  /**
   * Get or create instance from database config
   */
  getOrCreate(instanceName: string, apiUrl: string, apiKey: string): EvolutionClient {
    const existing = this.instances.get(instanceName)
    if (existing) return existing
    return this.register(instanceName, apiUrl, apiKey)
  }

  /**
   * List all registered instances
   */
  list(): string[] {
    return Array.from(this.instances.keys())
  }

  /**
   * Get status of all instances
   */
  async getAllStatuses(): Promise<Map<string, InstanceStatus | { error: string }>> {
    const statuses = new Map<string, InstanceStatus | { error: string }>()

    for (const [name, client] of this.instances) {
      try {
        const status = await client.getStatus()
        statuses.set(name, status)
      } catch (error) {
        statuses.set(name, { error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }

    return statuses
  }
}

// Singleton
let _manager: EvolutionManager | null = null

export function getEvolutionManager(): EvolutionManager {
  if (!_manager) {
    _manager = new EvolutionManager()
  }
  return _manager
}

export { EvolutionClient, EvolutionManager }
export type { EvolutionInstance, SendMessageParams, SendTemplateParams, EvolutionResponse, InstanceStatus, QRCodeResponse }
