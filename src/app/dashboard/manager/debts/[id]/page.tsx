import { RoleDebtDetailPage } from '@/components/debt/RoleDebtDetailPage'

export default function ManagerDebtDetailPage(props: { params: Promise<{ id: string }> }) {
  return <RoleDebtDetailPage {...props} dashboardRole="manager" />
}
