export type UserRole = 'admin' | 'manager' | 'collector'
export type DebtStatus = 'active' | 'in_progress' | 'promised' | 'partial' | 'in_negotiation' | 'payment_plan' | 'settled' | 'written_off' | 'legal' | 'disputed'
export type DebtPriority = 'low' | 'medium' | 'high' | 'critical'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type MessageChannel = 'whatsapp' | 'sms' | 'email' | 'call' | 'internal'
export type ActionType = 'call' | 'whatsapp' | 'email' | 'visit' | 'legal' | 'escalate' | 'settle'

export interface Company {
  id: string
  name: string
  slug: string
  logo_url?: string
  plan: 'starter' | 'growth' | 'enterprise'
  settings: Record<string, unknown>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  company_id: string
  email: string
  full_name?: string
  avatar_url?: string
  role: UserRole
  phone?: string
  is_active: boolean
  last_seen_at?: string
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  company_id: string
  full_name: string
  email?: string
  phone?: string
  whatsapp?: string
  national_id?: string
  address?: string
  city?: string
  country: string
  date_of_birth?: string
  employer?: string
  monthly_income?: number
  credit_score?: number
  risk_level: RiskLevel
  tags: string[]
  notes?: string
  metadata: Record<string, unknown>
  created_by?: string
  created_at: string
  updated_at: string
}

export interface Debt {
  id: string
  company_id: string
  customer_id: string
  assigned_to?: string
  reference_number: string
  original_amount: number
  current_balance: number
  interest_rate: number
  penalty_amount: number
  currency: string
  status: DebtStatus
  priority: DebtPriority
  due_date?: string
  last_payment_date?: string
  next_follow_up?: string
  product_type?: string
  creditor_name?: string
  account_number?: string
  notes?: string
  metadata: Record<string, unknown>
  created_by?: string
  created_at: string
  updated_at: string
  // Joins
  customer?: Customer
  assigned_collector?: Profile
}

export interface Payment {
  id: string
  company_id: string
  debt_id: string
  customer_id: string
  recorded_by?: string
  amount: number
  currency: string
  payment_method?: string
  payment_date: string
  reference_number?: string
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  notes?: string
  receipt_url?: string
  created_at: string
}

export interface Message {
  id: string
  company_id: string
  customer_id: string
  debt_id?: string
  sent_by?: string
  channel: MessageChannel
  direction: 'outbound' | 'inbound'
  content: string
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  whatsapp_message_id?: string
  metadata: Record<string, unknown>
  sent_at: string
  created_at: string
}

export interface AIScore {
  id: string
  company_id: string
  debt_id: string
  customer_id: string
  score: number
  risk_classification: RiskLevel
  collection_probability: number
  recommended_strategy?: string
  priority_rank?: number
  factors: AIFactor[]
  raw_response?: string
  model_version: string
  created_at: string
}

export interface AIFactor {
  name: string
  impact: 'positive' | 'negative' | 'neutral'
  weight: number
  description: string
}

export interface AIAction {
  id: string
  company_id: string
  debt_id: string
  customer_id: string
  assigned_to?: string
  action_type: ActionType
  priority: DebtPriority
  reason: string
  suggested_message?: string
  best_time_to_contact?: string
  status: 'pending' | 'completed' | 'skipped' | 'rescheduled'
  scheduled_for: string
  completed_at?: string
  outcome?: string
  created_at: string
  updated_at: string
  // Joins
  debt?: Debt
  customer?: Customer
}

export interface Log {
  id: string
  company_id: string
  user_id?: string
  entity_type: string
  entity_id: string
  action: string
  old_values?: Record<string, unknown>
  new_values?: Record<string, unknown>
  created_at: string
}

// Dashboard stats
export interface AdminStats {
  total_debts: number
  total_balance: number
  total_collected_this_month: number
  collection_rate: number
  active_customers: number
  overdue_debts: number
  ai_actions_today: number
  messages_sent_today: number
}

export interface CollectorStats {
  assigned_debts: number
  total_balance: number
  collected_this_month: number
  actions_pending: number
  actions_completed_today: number
}

// API response types
export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}

// AI Score request
export interface ScoreRequest {
  debt_id: string
  customer_id: string
  company_id: string
}

export interface RecommendRequest {
  company_id: string
  date?: string
  limit?: number
}

// ── Integration Settings ──────────────────────────────────────────────────

export type IntegrationName = 'rasf_whatsapp' | 'tameez_calls' | 'collection_api'

export interface IntegrationSetting {
  id:               string
  company_id:       string
  integration_name: IntegrationName
  enabled:          boolean
  config:           Record<string, string>
  last_synced_at:   string | null
  last_error:       string | null
  created_at:       string
  updated_at:       string
}
