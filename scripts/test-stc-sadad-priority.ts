// Verifies that buildCaseFile() prioritizes the per-customer SADAD number
// (debts.metadata.extra.sadad_number) over collection_accounts for the
// "where do I pay" payment-method section in the prompt.
import { buildCaseFile } from '../src/lib/ai-collector-agent'

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 }
  else console.log('PASS:', msg)
}

// Case 1: STC customer — has a per-customer sadad_number, NO collection_account.
const stcCtx = {
  debt: {
    creditor_name: 'STC',
    current_balance: 500,
    currency: 'SAR',
    metadata: { extra: { sadad_number: '123456789' } },
  },
  collection_account: null,
}
const stcCaseFile = buildCaseFile(stcCtx)
assert(stcCaseFile.includes('123456789'), 'STC case file includes the real per-customer SADAD number')
assert(stcCaseFile.includes('طريقة الدفع'), 'STC case file surfaces a payment-method section from sadad_number alone')
assert(!/آيبان|تحويل بنكي/.test(stcCaseFile), 'STC case file does not mention IBAN/bank transfer')

// Case 2: sadad_number present AND a collection_account also exists — sadad wins.
const conflictCtx = {
  debt: { creditor_name: 'STC', current_balance: 500, currency: 'SAR', metadata: { extra: { sadad_number: '999000111' } } },
  collection_account: { method_type: 'bank_transfer', iban: 'SA0000000000000000000000' },
}
const conflictCaseFile = buildCaseFile(conflictCtx)
assert(conflictCaseFile.includes('999000111'), 'sadad_number wins over an existing collection_account')
assert(!conflictCaseFile.includes('SA0000000000000000000000'), 'collection_account IBAN is ignored when sadad_number exists')

// Case 3: no sadad_number, but a collection_account exists — falls back correctly.
const fallbackCtx = {
  debt: { creditor_name: 'OtherCo', current_balance: 200, currency: 'SAR', metadata: { extra: {} } },
  collection_account: { method_type: 'bank_transfer', iban: 'SA1111111111111111111111', account_name: 'Test' },
}
const fallbackCaseFile = buildCaseFile(fallbackCtx)
assert(fallbackCaseFile.includes('SA1111111111111111111111'), 'falls back to collection_account IBAN when no sadad_number exists')

// Case 4: neither sadad_number nor collection_account — no payment-method section at all.
const noneCtx = {
  debt: { creditor_name: 'OtherCo', current_balance: 200, currency: 'SAR', metadata: { extra: {} } },
  collection_account: null,
}
const noneCaseFile = buildCaseFile(noneCtx)
assert(!noneCaseFile.includes('طريقة الدفع'), 'no payment-method section shown when neither source exists (J2 handles it)')

if (process.exitCode === 1) process.exit(1)
console.log('\nAll checks passed.')
