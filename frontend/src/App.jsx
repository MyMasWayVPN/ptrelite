import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'

// Store
import { useAuthStore } from '@store/authStore'
import { useThemeStore } from '@store/themeStore'

// Components
import Layout from '@components/Layout/Layout'
import ProtectedRoute from '@components/Auth/ProtectedRoute'
import LoadingSpinner from '@components/UI/LoadingSpinner'

// Pages
import LoginPage from '@pages/Auth/LoginPage'
import DashboardPage from '@pages/Dashboard/DashboardPage'
import AdminDashboardPage from '@pages/Admin/AdminDashboardPage'
import MemberDashboardPage from '@pages/Member/MemberDashboardPage'
import ContainersPage from '@pages/Containers/ContainersPage'
import ContainerDetailPage from '@pages/Containers/ContainerDetailPage'
import ConsolePage from '@pages/Console/ConsolePage'
import FileManagerPage from '@pages/FileManager/FileManagerPage'
import TunnelsPage from '@pages/Tunnels/TunnelsPage'
import ProfilePage from '@pages/Profile/ProfilePage'
import AdminUsersPage from '@pages/Admin/AdminUsersPage'
import AdminContainersPage from '@pages/Admin/AdminContainersPage'
import AdminLogsPage from '@pages/Admin/AdminLogsPage'
import AdminSettingsPage from '@pages/Admin/AdminSettingsPage'
import NotFoundPage from '@pages/Error/NotFoundPage'

function App() {
  const { user, isLoading, checkAuth } = useAuthStore()
  const { theme, initializeTheme } = useThemeStore()

  // Initialize app
  useEffect(() => {
    initializeTheme()
    checkAuth()
  }, [initializeTheme, checkAuth])

  // Apply theme to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Routes>
        {/* Public Routes */}
        <Route 
          path="/login" 
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage />
            )
          } 
        />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Dashboard Routes */}
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          
          {/* Admin Routes */}
          <Route
            path="admin"
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/users"
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminUsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/containers"
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminContainersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/logs"
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminLogsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="admin/settings"
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminSettingsPage />
              </ProtectedRoute>
            }
          />

          {/* Member Routes */}
          <Route
            path="member"
            element={
              <ProtectedRoute requiredRole="MEMBER">
                <MemberDashboardPage />
              </ProtectedRoute>
            }
          />

          {/* Container Routes */}
          <Route path="containers" element={<ContainersPage />} />
          <Route path="containers/:id" element={<ContainerDetailPage />} />
          <Route path="containers/:id/console" element={<ConsolePage />} />
          <Route path="containers/:id/files" element={<FileManagerPage />} />
          <Route path="containers/:id/tunnels" element={<TunnelsPage />} />

          {/* Profile Routes */}
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* 404 Route */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  )
}

export default App
