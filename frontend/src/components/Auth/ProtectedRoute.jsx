import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@store/authStore'
import LoadingSpinner from '@components/UI/LoadingSpinner'

const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { user, isAuthenticated, isLoading } = useAuthStore()
  const location = useLocation()

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner size="lg" text="Memuat..." />
      </div>
    )
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check role-based access
  if (requiredRole && user.role !== requiredRole) {
    // Redirect based on user role
    const redirectPath = user.role === 'ADMIN' ? '/admin' : '/member'
    return <Navigate to={redirectPath} replace />
  }

  return children
}

export default ProtectedRoute
