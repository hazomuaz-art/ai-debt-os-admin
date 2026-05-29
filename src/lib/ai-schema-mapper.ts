import OpenAI from 'openai'

export type AutoSchemaDetectionInput = {
  source_name?: string
  columns: string[]
  sample_rows?: Record<string, unknown>[]
  project_type?: string
}

export type AutoSchemaDetectionResult = {
  confidence: number
  field_mapping: Record<string, string>
  status_mapping: Record<string, {
    base_status: string
    custom_status?: string
    meaning_ar?: string
  }>
  detected_project_type?: string
  notes: string[]
}

const CORE_FIELDS = [
  'customer.full_name',
  'customer.national_id',
  'customer.phone',
  'customer.whatsapp',
  'customer.city',
  'debt.original_amount',
  'debt.current_balance',
  'debt.currency',
  'debt.status',
  'debt.reference_number',
  'debt.creditor_name',
  'debt.product_type',
  'debt.due_date',
  'debt.account_number',
  'metadata.claim_number',
  'metadata.accident_date',
  'metadata.claim_reason',
  'metadata.meter_number',
  'metadata.policy_number',
  'metadata.extra'
]

const BASE_STATUSES = [
  'active',
  'paid_full',
  'paid_partial',
  'promise_to_pay',
  'refused_to_pay',
  'wrong_number',
  'not_customer',
  'dispute',
  'installment_request',
  'receipt_received',
  'needs_review',
  'legal',
  'closed'
]

export async function detectSchemaWithAI(
  input: AutoSchemaDetectionInput
): Promise<AutoSchemaDetectionResult> {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackDetectSchema(input)
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const prompt = `
You are an enterprise debt collection data integration AI.

Your task:
Analyze incoming collection-system columns and sample rows.
Automatically map them to AI Debt OS fields.

Core AI Debt OS fields:
${JSON.stringify(CORE_FIELDS, null, 2)}

Base statuses:
${JSON.stringify(BASE_STATUSES, null, 2)}

Rules:
- Map customer identity fields correctly.
- Map debt amount, balance, status, reference, account, claim fields.
- If a field is specific to insurance, electricity, telecom, or another project, map it to metadata.<name>.
- Detect project type if possible: telecom, insurance, electricity, banking, generic_collection, other.
- For statuses, map original status text to base_status and optional custom_status.
- Arabic and English column names must both be understood.
- Return JSON only.
- Never invent data. If unsure, use metadata.extra and lower confidence.

Input:
${JSON.stringify(input, null, 2)}

Return exactly:
{
  "confidence": 0.0,
  "field_mapping": {
    "source_column": "target_field"
  },
  "status_mapping": {
    "source_status": {
      "base_status": "active",
      "custom_status": "optional_custom_code",
      "meaning_ar": "Arabic meaning"
    }
  },
  "detected_project_type": "telecom|insurance|electricity|banking|generic_collection|other",
  "notes": ["..."]
}
`

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }]
  })

  const content = res.choices[0]?.message?.content
  if (!content) return fallbackDetectSchema(input)

  try {
    return JSON.parse(content) as AutoSchemaDetectionResult
  } catch {
    return fallbackDetectSchema(input)
  }
}

export function fallbackDetectSchema(
  input: AutoSchemaDetectionInput
): AutoSchemaDetectionResult {
  const mapping: Record<string, string> = {}

  for (const col of input.columns) {
    const c = col.toLowerCase()

    if (c.includes('name') || col.includes('اسم')) mapping[col] = 'customer.full_name'
    else if (c.includes('national') || c.includes('id') || col.includes('هوية')) mapping[col] = 'customer.national_id'
    else if (c.includes('phone') || c.includes('mobile') || col.includes('جوال') || col.includes('هاتف')) mapping[col] = 'customer.phone'
    else if (c.includes('amount') || col.includes('مبلغ')) mapping[col] = 'debt.current_balance'
    else if (c.includes('balance') || col.includes('رصيد')) mapping[col] = 'debt.current_balance'
    else if (c.includes('status') || col.includes('حالة')) mapping[col] = 'debt.status'
    else if (c.includes('account') || col.includes('حساب')) mapping[col] = 'debt.account_number'
    else if (c.includes('claim') || col.includes('مطالبة')) mapping[col] = 'metadata.claim_number'
    else if (c.includes('accident') || col.includes('حادث')) mapping[col] = 'metadata.accident_date'
    else mapping[col] = 'metadata.extra'
  }

  return {
    confidence: 0.55,
    field_mapping: mapping,
    status_mapping: {},
    detected_project_type: input.project_type ?? 'other',
    notes: ['Fallback mapping used because AI mapping was unavailable or failed.']
  }
}
