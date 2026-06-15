import { redirect } from 'next/navigation'

// Customers and debts are now a single unified page.
export default function AdminCustomersPage() {
  redirect('/dashboard/admin/debts')
}
