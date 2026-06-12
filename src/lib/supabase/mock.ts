// Mock Supabase Client for local testing when real Supabase is not configured.
// It provides seed-like realistic data and allows full signup/login workflows.

const mockAuthUser = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  email: 'admin@aidebtos.com',
  user_metadata: {
    role: 'admin',
    full_name: 'Admin User',
  },
  app_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
};

const mockAuthSession = {
  access_token: 'mock-token-xyz',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'mock-refresh-token',
  user: mockAuthUser,
};

const mockProfile = {
  id: 'bbbbbbbb-0000-4000-8000-000000000001',
  company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  email: 'admin@aidebtos.com',
  full_name: 'Admin User',
  role: 'admin',
  is_active: true,
};

const mockCompany = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'AI Debt OS Demo',
  slug: 'ai-debt-os-demo',
  plan: 'growth',
  is_active: true,
  settings: {
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    language: 'en',
    whatsapp_enabled: true,
    ai_scoring_enabled: true,
  },
};

const mockCustomers = [
  { id: 'dddd0001-0000-4000-8000-000000000001', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Ahmed Al-Rashid', phone: '+966501234567', whatsapp: '+966501234567', national_id: '1234567891', city: 'Riyadh', employer: 'Saudi Aramco', monthly_income: 25000, risk_level: 'medium' },
  { id: 'dddd0001-0000-4000-8000-000000000002', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Fatima Al-Hassan', phone: '+966509876543', whatsapp: '+966509876543', national_id: '1234567892', city: 'Jeddah', employer: 'Ministry of Health', monthly_income: 12000, risk_level: 'low' },
  { id: 'dddd0001-0000-4000-8000-000000000003', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Mohammed Al-Otaibi', phone: '+966551122334', whatsapp: null, national_id: '1234567893', city: 'Riyadh', employer: 'Freelance', monthly_income: 8000, risk_level: 'high' },
  { id: 'dddd0001-0000-4000-8000-000000000004', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Sara Al-Ghamdi', phone: '+966567890123', whatsapp: '+966567890123', national_id: '1234567894', city: 'Dammam', employer: 'SABIC', monthly_income: 18000, risk_level: 'low' },
  { id: 'dddd0001-0000-4000-8000-000000000005', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Khalid Al-Shehri', phone: '+966512345678', whatsapp: null, national_id: '1234567895', city: 'Mecca', employer: 'Unemployed', monthly_income: 0, risk_level: 'critical' },
];

const mockDebts = [
  {
    id: 'eeee0001-0000-4000-8000-000000000001',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000001',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-001',
    original_amount: 75000,
    current_balance: 62000,
    currency: 'SAR',
    status: 'active',
    priority: 'high',
    due_date: new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0],
    product_type: 'Personal Loan',
    account_number: 'ACC-001-2024',
    created_at: new Date(Date.now() - 50 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000001', full_name: 'Ahmed Al-Rashid', phone: '+966501234567', whatsapp: '+966501234567' },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: [{ score: 72, risk_classification: 'medium', collection_probability: 0.65, created_at: new Date().toISOString() }]
  },
  {
    id: 'eeee0001-0000-4000-8000-000000000002',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000002',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-002',
    original_amount: 25000,
    current_balance: 25000,
    currency: 'SAR',
    status: 'active',
    priority: 'medium',
    due_date: new Date(Date.now() - 15 * 86400000).toISOString().split('T')[0],
    product_type: 'Credit Card',
    account_number: 'ACC-002-2024',
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000002', full_name: 'Fatima Al-Hassan', phone: '+966509876543', whatsapp: '+966509876543' },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: []
  },
  {
    id: 'eeee0001-0000-4000-8000-000000000003',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000003',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-003',
    original_amount: 45000,
    current_balance: 45000,
    currency: 'SAR',
    status: 'legal',
    priority: 'critical',
    due_date: new Date(Date.now() - 200 * 86400000).toISOString().split('T')[0],
    product_type: 'Auto Loan',
    account_number: 'ACC-003-2024',
    created_at: new Date(Date.now() - 210 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000003', full_name: 'Mohammed Al-Otaibi', phone: '+966551122334', whatsapp: null },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: [{ score: 18, risk_classification: 'critical', collection_probability: 0.12, created_at: new Date().toISOString() }]
  },
  {
    id: 'eeee0001-0000-4000-8000-000000000004',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000004',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-004',
    original_amount: 15000,
    current_balance: 7500,
    currency: 'SAR',
    status: 'partial',
    priority: 'medium',
    due_date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
    product_type: 'Personal Loan',
    account_number: 'ACC-004-2024',
    created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000004', full_name: 'Sara Al-Ghamdi', phone: '+966567890123', whatsapp: '+966567890123' },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: []
  },
  {
    id: 'eeee0001-0000-4000-8000-000000000005',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000005',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-005',
    original_amount: 120000,
    current_balance: 120000,
    currency: 'SAR',
    status: 'active',
    priority: 'critical',
    due_date: new Date(Date.now() - 120 * 86400000).toISOString().split('T')[0],
    product_type: 'Mortgage',
    account_number: 'ACC-005-2024',
    created_at: new Date(Date.now() - 125 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000005', full_name: 'Khalid Al-Shehri', phone: '+966512345678', whatsapp: null },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: [{ score: 12, risk_classification: 'critical', collection_probability: 0.08, created_at: new Date().toISOString() }]
  },
  {
    id: 'eeee0001-0000-4000-8000-000000000006',
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    customer_id: 'dddd0001-0000-4000-8000-000000000001',
    created_by: 'bbbbbbbb-0000-4000-8000-000000000001',
    reference_number: 'DEB-DEMO-006',
    original_amount: 30000,
    current_balance: 0,
    currency: 'SAR',
    status: 'settled',
    priority: 'low',
    due_date: new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0],
    product_type: 'Credit Card',
    account_number: 'ACC-006-2024',
    created_at: new Date(Date.now() - 95 * 86400000).toISOString(),
    customer: { id: 'dddd0001-0000-4000-8000-000000000001', full_name: 'Ahmed Al-Rashid', phone: '+966501234567', whatsapp: '+966501234567' },
    assigned_collector: { id: 'bbbbbbbb-0000-4000-8000-000000000001', full_name: 'Admin User', email: 'admin@aidebtos.com' },
    ai_scores: []
  }
];

const mockPayments = [
  { id: 'ffff0001-0000-4000-8000-000000000001', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', amount: 13000, currency: 'SAR', payment_method: 'bank_transfer', payment_date: new Date(Date.now() - 20 * 86400000).toISOString().split('T')[0], status: 'completed' },
  { id: 'ffff0001-0000-4000-8000-000000000002', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', amount: 7500, currency: 'SAR', payment_method: 'cash', payment_date: new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0], status: 'completed' },
  { id: 'ffff0001-0000-4000-8000-000000000003', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', amount: 30000, currency: 'SAR', payment_method: 'bank_transfer', payment_date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0], status: 'completed' }
];

const mockAiActions = [
  { id: '1', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', action_type: 'whatsapp', status: 'completed', scheduled_for: new Date().toISOString().split('T')[0], created_at: new Date(Date.now() - 15 * 60000).toISOString(), customer: { full_name: 'Ahmed Al-Rashid' }, debt: { reference_number: 'DEB-DEMO-001' } },
  { id: '2', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', action_type: 'call', status: 'completed', scheduled_for: new Date().toISOString().split('T')[0], created_at: new Date(Date.now() - 60 * 60000).toISOString(), customer: { full_name: 'Fatima Al-Hassan' }, debt: { reference_number: 'DEB-DEMO-002' } },
  { id: '3', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', action_type: 'whatsapp', status: 'pending', scheduled_for: new Date().toISOString().split('T')[0], created_at: new Date(Date.now() - 3 * 3600000).toISOString(), customer: { full_name: 'Sara Al-Ghamdi' }, debt: { reference_number: 'DEB-DEMO-004' } },
];

const mockMessages = [
  { id: '1', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', body: 'Hello Ahmed, a reminder for your payment.', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: '2', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', body: 'Payment confirmation received from Ahmed.', created_at: new Date(Date.now() - 1800000).toISOString() }
];

const mockCampaigns = [
  { id: '1', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'High Priority Overdue', status: 'running' }
];

const mockSystemAlerts = [
  { id: '1', company_id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Payment received from Ahmed Al-Rashid', severity: 'info', is_resolved: false, created_at: new Date(Date.now() - 1800000).toISOString() }
];

class MockQueryBuilder {
  private table: string;
  constructor(table: string) {
    this.table = table;
  }
  select() { return this; }
  insert() { return this; }
  update() { return this; }
  delete() { return this; }
  eq() { return this; }
  neq() { return this; }
  gte() { return this; }
  lte() { return this; }
  lt() { return this; }
  not() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  single() {
    return {
      then: (resolve: any) => {
        let data: any = null;
        if (this.table === 'profiles') data = mockProfile;
        else if (this.table === 'companies') data = mockCompany;
        else if (this.table === 'customers') data = mockCustomers[0];
        else if (this.table === 'debts') data = mockDebts[0];
        else if (this.table === 'payments') data = mockPayments[0];
        
        resolve({ data, error: null });
      }
    };
  }
  maybeSingle() {
    return {
      then: (resolve: any) => {
        resolve({ data: null, error: null });
      }
    };
  }
  then(resolve: any) {
    let data: any[] = [];
    if (this.table === 'debts') data = mockDebts;
    else if (this.table === 'payments') data = mockPayments;
    else if (this.table === 'customers') data = mockCustomers;
    else if (this.table === 'ai_actions') data = mockAiActions;
    else if (this.table === 'messages') data = mockMessages;
    else if (this.table === 'campaigns') data = mockCampaigns;
    else if (this.table === 'system_alerts') data = mockSystemAlerts;
    else if (this.table === 'profiles') data = [mockProfile];
    else if (this.table === 'companies') data = [mockCompany];
    
    resolve({ data, error: null, count: data.length });
  }
}

export function getMockSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: mockAuthUser },
        error: null,
      }),
      signUp: async ({ email }: { email: string }) => ({
        data: { user: { ...mockAuthUser, email } },
        error: null,
      }),
      signInWithPassword: async () => ({
        data: { user: mockAuthUser, session: mockAuthSession },
        error: null,
      }),
      signOut: async () => ({
        error: null,
      }),
      admin: {
        deleteUser: async () => ({ error: null }),
      }
    },
    from: (table: string) => new MockQueryBuilder(table),
    rpc: async () => ({ data: null, error: null }),
  } as any;
}
