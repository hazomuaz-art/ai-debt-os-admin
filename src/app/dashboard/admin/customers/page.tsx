import { redirect } from 'next/navigation'

// Customers have been merged into the unified "العملاء والمديونيات" page.
export default function AdminCustomersPage() {
  redirect('/dashboard/admin/debts?view=customers')
}
