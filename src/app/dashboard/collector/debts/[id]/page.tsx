import { RoleDebtDetailPage } from '@/components/debt/RoleDebtDetailPage'

export default function CollectorDebtDetailPage(props: { params: Promise<{ id: string }> }) {
  return <RoleDebtDetailPage {...props} dashboardRole="collector" />
}
