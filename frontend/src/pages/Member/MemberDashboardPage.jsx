import { useState, useEffect } from 'react'
import { useQuery } from 'react-query'
import { Link } from 'react-router-dom'
import {
  ServerIcon,
  PlusIcon,
  PlayIcon,
  StopIcon,
  CommandLineIcon,
  FolderIcon,
  CloudIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'
import { memberAPI } from '@services/api'
import { useAuthStore } from '@store/authStore'
import LoadingSpinner from '@components/UI/LoadingSpinner'

const MemberDashboardPage = () => {
  const { user } = useAuthStore()
  const { data: dashboard, isLoading, error } = useQuery(
    'member-dashboard',
    memberAPI.getDashboard,
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Memuat dashboard..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md bg-error-50 dark:bg-error-900/20 p-4">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-error-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-error-800 dark:text-error-200">
              Gagal memuat dashboard
            </h3>
            <p className="mt-1 text-sm text-error-700 dark:text-error-300">
              {error.response?.data?.message || 'Terjadi kesalahan saat memuat data'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const container = dashboard?.container
  const stats = dashboard?.stats

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard Member
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Selamat datang, {user?.username}! Kelola container Anda di sini.
        </p>
      </div>

      {/* Container Status */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Container Anda
            </h3>
            {!container && (
              <Link to="/containers" className="btn btn-primary btn-sm">
                <PlusIcon className="h-4 w-4 mr-2" />
                Buat Container
              </Link>
            )}
          </div>
        </div>
        <div className="card-body">
          {container ? (
            <div className="space-y-4">
              {/* Container Info */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <ServerIcon className="h-8 w-8 text-primary-600 dark:text-primary-400" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                      {container.name}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {container.image} • {container.status}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`status-dot ${
                    container.status === 'running' ? 'status-running' :
                    container.status === 'stopped' ? 'status-stopped' :
                    'status-error'
                  }`}></span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                    {container.status}
                  </span>
                </div>
              </div>

              {/* Container Actions */}
              <div className="flex flex-wrap gap-3">
                <Link 
                  to={`/containers/${container.id}/console`}
                  className="btn btn-primary btn-sm"
                >
                  <CommandLineIcon className="h-4 w-4 mr-2" />
                  Console
                </Link>
                <Link 
                  to={`/containers/${container.id}/files`}
                  className="btn btn-secondary btn-sm"
                >
                  <FolderIcon className="h-4 w-4 mr-2" />
                  File Manager
                </Link>
                <Link 
                  to={`/containers/${container.id}/tunnels`}
                  className="btn btn-secondary btn-sm"
                >
                  <CloudIcon className="h-4 w-4 mr-2" />
                  Tunnels
                </Link>
                {container.status === 'running' ? (
                  <button className="btn btn-warning btn-sm">
                    <StopIcon className="h-4 w-4 mr-2" />
                    Stop
                  </button>
                ) : (
                  <button className="btn btn-success btn-sm">
                    <PlayIcon className="h-4 w-4 mr-2" />
                    Start
                  </button>
                )}
              </div>

              {/* Container Stats */}
              {stats && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                  <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      CPU Usage
                    </div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {stats.cpu?.toFixed(1) || 0}%
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      Memory Usage
                    </div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {stats.memory?.toFixed(1) || 0}%
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                      Uptime
                    </div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {stats.uptime || '0s'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <ServerIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                Belum ada container
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Mulai dengan membuat container pertama Anda.
              </p>
              <div className="mt-6">
                <Link to="/containers" className="btn btn-primary">
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Buat Container
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ServerIcon className="h-6 w-6 text-primary-600 dark:text-primary-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Container
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {container ? 1 : 0} / 1
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CloudIcon className="h-6 w-6 text-success-600 dark:text-success-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Tunnels
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dashboard?.tunnels?.length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <FolderIcon className="h-6 w-6 text-warning-600 dark:text-warning-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Files
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dashboard?.files?.count || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <CommandLineIcon className="h-6 w-6 text-error-600 dark:text-error-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Sessions
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dashboard?.sessions?.active || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Aktivitas Terbaru
          </h3>
        </div>
        <div className="card-body">
          {dashboard?.recentActivity?.length > 0 ? (
            <div className="space-y-3">
              {dashboard.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-2 h-2 bg-primary-500 rounded-full mt-2"></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white">
                      {activity.message}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(activity.timestamp).toLocaleString('id-ID')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Tidak ada aktivitas terbaru
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default MemberDashboardPage
