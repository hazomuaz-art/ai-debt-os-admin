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

export type IntegrationName = 'rasf_whatsapp' | 'tameez_calls' | 'collection_api' | 'waha'

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

// ── Portfolios / Projects ─────────────────────────────────────────────────

export type PortfolioCategory = 'telecom' | 'insurance' | 'utility' | 'recruitment' | 'government' | 'finance' | 'agriculture' | 'other'

export interface Portfolio {
  id:             string
  company_id:     string
  name:           string
  name_ar?:       string
  code:           string
  category:       PortfolioCategory
  external_id?:   string
  source_system:  'manual' | 'debit_collect' | 'tamiuzz' | 'api'
  color:          string
  is_active:      boolean
  notes?:         string
  metadata:       Record<string, unknown>
  created_at:     string
  updated_at:     string
}

// ── Debit Collect / Tamiuzz Sync ─────────────────────────────────────────

export interface DebitCollectRecord {
  external_customer_id:  string
  external_debt_id:      string
  portfolio_name:        string
  portfolio_code:        string
  customer_name:         string
  customer_phone:        string
  customer_national_id?: string
  debt_amount:           number
  remaining_amount:      number
  payment_status:        string
  contact_status:        string
  collector_name:        string
  last_contact_result:   string
  last_contact_date?:    string
  notes?:                string
}

export interface SyncResult {
  id:                string
  company_id:        string
  source_system:     string
  sync_type:         string
  status:            string
  records_total:     number
  records_processed: number
  records_failed:    number
  error_log:         unknown[]
  started_at:        string
  completed_at?:     string
}

// ── AI Cost Log ───────────────────────────────────────────────────────────

export type CostProvider = 'openai' | 'whatsapp' | 'tameez' | 'rasf' | 'storage' | 'external' | 'other'

export interface AICostEntry {
  id:                string
  company_id:        string
  provider:          CostProvider
  model?:            string
  action_type:       string
  input_tokens:      number
  output_tokens:     number
  total_tokens:      number
  estimated_cost:    number
  portfolio_id?:     string
  portfolio_name?:   string
  customer_id?:      string
  customer_reference?: string
  debt_id?:          string
  collector_id?:     string
  collector_name?:   string
  duration_ms?:      number
  success:           boolean
  error_message?:    string
  metadata:          Record<string, unknown>
  created_at:        string
}

// ── Cost Settings ─────────────────────────────────────────────────────────

export interface CostSettings {
  id:                      string
  company_id:              string
  openai_input_per_1m:     number
  openai_output_per_1m:    number
  whatsapp_outbound:       number
  whatsapp_inbound:        number
  call_analysis_per_min:   number
  storage_per_gb:          number
  external_api_per_call:   number
  updated_at:              string
}

// ── Advanced AI Collection Modules ────────────────────────────────────────

export type AutomationMode = 'off' | 'test' | 'live'
export type BehaviorType   = 'cooperative' | 'procrastinator' | 'refusing' | 'angry' | 'evasive' | 'negotiable' | 'unknown'
export type PromiseStatus  = 'pending' | 'kept' | 'broken' | 'rescheduled' | 'partial'
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'
export type ApprovalType   = 'large_settlement' | 'discount' | 'legal_escalation' | 'stop_followup' | 'write_off' | 'ai_learning' | 'campaign_launch' | 'custom'
export type AlertSeverity  = 'info' | 'warning' | 'error' | 'critical'
export type FeatureFlagStatus = 'disabled' | 'internal_test' | 'limited' | 'production'

export interface SystemConfig {
  id:              string
  company_id:      string
  automation_mode: AutomationMode
  modules:         Record<string, boolean>
  daily_ai_calls_limit:      number
  daily_whatsapp_limit:      number
  daily_call_analysis_limit: number
  monthly_cost_limit:        number
  limit_fallback:            string
  emergency_stop_all:        boolean
  emergency_stop_ai:         boolean
  emergency_stop_whatsapp:   boolean
  emergency_stop_calls:      boolean
  voice_agent_name:          string
  voice_dialect:             string
  call_hours_start:          string
  call_hours_end:            string
  daily_call_limit:          number
  updated_at:                string
}

export interface CollectionRule {
  id:          string
  company_id:  string
  name:        string
  description?: string
  condition:   Record<string, unknown>
  action:      string
  action_params: Record<string, unknown>
  priority:    number
  is_active:   boolean
  trigger_count: number
  last_triggered_at?: string
  created_at:  string
}

export interface AIMemoryEntry {
  id:              string
  company_id:      string
  trigger_pattern: string
  trigger_type:    string
  response_text:   string
  language:        string
  category:        string
  success_count:   number
  failure_count:   number
  use_count:       number
  success_rate:    number
  last_used_at?:   string
  status:          string
  is_active:       boolean
  source:          string
  created_at:      string
}

export interface CustomerBehavior {
  id:                 string
  company_id:         string
  customer_id:        string
  behavior_type:      BehaviorType
  behavior_score:     number
  risk_level:         string
  total_contacts:     number
  successful_contacts: number
  promises_made:      number
  promises_kept:      number
  ai_notes?:          string
  negotiation_style:  string
  preferred_channel:  string
  best_contact_time?: string
  updated_at:         string
}

export interface Promise {
  id:               string
  company_id:       string
  customer_id:      string
  debt_id:          string
  promised_amount:  number
  promised_date:    string
  channel:          string
  status:           PromiseStatus
  notes?:           string
  created_at:       string
}

export interface Campaign {
  id:             string
  company_id:     string
  name:           string
  description?:   string
  campaign_type:  string
  status:         CampaignStatus
  channels:       string[]
  target_count:   number
  sent_count:     number
  payment_count:  number
  total_collected: number
  scheduled_at?:  string
  created_at:     string
}

export interface Approval {
  id:            string
  company_id:    string
  approval_type: ApprovalType
  title:         string
  description?:  string
  entity_type?:  string
  entity_id?:    string
  status:        string
  priority:      string
  requested_by?: string
  expires_at?:   string
  created_at:    string
}

export interface TimelineEvent {
  id:          string
  company_id:  string
  customer_id: string
  debt_id?:    string
  event_type:  string
  channel?:    string
  summary:     string
  detail?:     string
  amount?:     number
  actor_type:  string
  actor_name?: string
  ai_used:     boolean
  occurred_at: string
}

export interface SystemAlert {
  id:          string
  company_id?: string
  severity:    AlertSeverity
  alert_type:  string
  title:       string
  message?:    string
  is_read:     boolean
  is_resolved: boolean
  created_at:  string
}

export interface FeatureFlag {
  id:          string
  feature_key: string
  status:      FeatureFlagStatus
  rollout_pct: number
  notes?:      string
}

export interface VoiceStats {
  planned:       number
  successful:    number
  promises:      number
  refused:       number
  avg_duration:  number
  total_cost:    number
}

// ── SaaS Plans & Subscriptions ────────────────────────────────────────────
// Full types live in src/lib/saas-plans.ts — import directly from there.
// Duplicate key shapes here for convenience:

export type SaasPlanName = 'starter' | 'business' | 'enterprise' | 'growth'
export type SaasSubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
