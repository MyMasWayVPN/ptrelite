import { useState, useEffect } from 'react'
import { useQuery } from 'react-query'
import {
  ServerIcon,
  UsersIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline'
import { adminAPI } from '@services/api'
import LoadingSpinner from '@components/UI/LoadingSpinner'

const AdminDashboardPage = () => {
  const { data: stats, isLoading, error } = useQuery(
    'admin-stats',
    adminAPI.getStats,
    {
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Memuat statistik..." />
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
              Gagal memuat statistik
            </h3>
            <p className="mt-1 text-sm text-error-700 dark:text-error-300">
              {error.response?.data?.message || 'Terjadi kesalahan saat memuat data'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statCards = [
    {
      name: 'Total User',
      value: stats?.users?.total || 0,
      change: stats?.users?.change || 0,
      icon: UsersIcon,
      color: 'primary',
    },
    {
      name: 'Total Container',
      value: stats?.containers?.total || 0,
      change: stats?.containers?.change || 0,
      icon: ServerIcon,
      color: 'success',
    },
    {
      name: 'Container Aktif',
      value: stats?.containers?.running || 0,
      change: stats?.containers?.runningChange || 0,
      icon: CpuChipIcon,
      color: 'warning',
    },
    {
      name: 'Log Hari Ini',
      value: stats?.logs?.today || 0,
      change: stats?.logs?.change || 0,
      icon: DocumentTextIcon,
      color: 'error',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Admin Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Selamat datang di panel administrator. Kelola sistem dan monitor aktivitas.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.name} className="card">
            <div className="card-body">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`p-3 rounded-lg bg-${stat.color}-100 dark:bg-${stat.color}-900/20`}>
                    <stat.icon className={`h-6 w-6 text-${stat.color}-600 dark:text-${stat.color}-400`} />
                  </div>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                      {stat.name}
                    </dt>
                    <dd className="flex items-baseline">
                      <div className="text-2xl font-semibold text-gray-900 dark:text-white">
                        {stat.value.toLocaleString()}
                      </div>
                      {stat.change !== 0 && (
                        <div className={`ml-2 flex items-baseline text-sm font-semibold ${
                          stat.change > 0 
                            ? 'text-success-600 dark:text-success-400' 
                            : 'text-error-600 dark:text-error-400'
                        }`}>
                          {stat.change > 0 ? '+' : ''}{stat.change}
                        </div>
                      )}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Aktivitas Terbaru
            </h3>
          </div>
          <div className="card-body">
            {stats?.recentActivity?.length > 0 ? (
              <div className="space-y-3">
                {stats.recentActivity.map((activity, index) => (
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

        {/* System Health */}
        <div className="card">
          <div className="card-header">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Status Sistem
            </h3>
          </div>
          <div className="card-body">
            <div className="space-y-4">
              {stats?.systemHealth && Object.entries(stats.systemHealth).map(([service, status]) => (
                <div key={service} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                    {service}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    status === 'healthy' 
                      ? 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-200'
                      : 'bg-error-100 text-error-800 dark:bg-error-900 dark:text-error-200'
                  }`}>
                    {status === 'healthy' ? 'Sehat' : 'Bermasalah'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Aksi Cepat
          </h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button className="btn btn-primary">
              <UsersIcon className="h-4 w-4 mr-2" />
              Kelola User
            </button>
            <button className="btn btn-secondary">
              <ServerIcon className="h-4 w-4 mr-2" />
              Lihat Container
            </button>
            <button className="btn btn-secondary">
              <DocumentTextIcon className="h-4 w-4 mr-2" />
              Log Sistem
            </button>
            <button className="btn btn-secondary">
              <ChartBarIcon className="h-4 w-4 mr-2" />
              Laporan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminDashboardPage
