import { redirect } from 'next/navigation'
import { getAuthToken } from '@/lib/auth-server'
import { PaymentsList } from '@/components/dashboard/payments-list'

export default async function PaymentsPage() {
    const token = await getAuthToken()
    if (!token) redirect('/login')

    return <PaymentsList />
}
