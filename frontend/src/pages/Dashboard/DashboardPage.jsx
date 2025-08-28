import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@store/authStore'

const DashboardPage = () => {
  const { user } = useAuthStore()

  // Redirect based on user role
  if (user?.role === 'ADMIN') {
    return <Navigate to="/admin" replace />
  }

  if (user?.role === 'MEMBER') {
    return <Navigate to="/member" replace />
  }

  // Fallback for unknown roles
  return <Navigate to="/login" replace />
}

export default DashboardPage
