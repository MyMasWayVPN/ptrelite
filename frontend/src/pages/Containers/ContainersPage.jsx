import { useState } from 'react'
import { useQuery } from 'react-query'
import { Link } from 'react-router-dom'
import {
  PlusIcon,
  ServerIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'
import { containerAPI } from '@services/api'
import { useAuthStore } from '@store/authStore'
import LoadingSpinner from '@components/UI/LoadingSpinner'

const ContainersPage = () => {
  const { user } = useAuthStore()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery(
    ['containers', { page, search }],
    () => containerAPI.getContainers({ page, search, limit: 10 }),
    {
      keepPreviousData: true,
    }
  )

  const containers = data?.data?.containers || []
  const pagination = data?.data?.pagination || {}

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="Memuat container..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Container
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Kelola container Docker Anda
          </p>
        </div>
        {(user?.role === 'ADMIN' || containers.length === 0) && (
          <Link to="/containers/create" className="btn btn-primary">
            <PlusIcon className="h-4 w-4 mr-2" />
            Buat Container
          </Link>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center space-x-4">
        <div className="flex-1 max-w-md">
          <input
            type="text"
            placeholder="Cari container..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>
      </div>

      {/* Container List */}
      {containers.length > 0 ? (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table">
              <thead className="table-header">
                <tr>
                  <th className="table-header-cell">Container</th>
                  <th className="table-header-cell">Image</th>
                  <th className="table-header-cell">Status</th>
                  <th className="table-header-cell">Owner</th>
                  <th className="table-header-cell">Created</th>
                  <th className="table-header-cell">Actions</th>
                </tr>
              </thead>
              <tbody className="table-body">
                {containers.map((container) => (
                  <tr key={container.id} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center">
                        <ServerIcon className="h-5 w-5 text-gray-400 mr-3" />
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {container.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {container.id.substring(0, 12)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                        {container.image}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span className={`badge ${
                        container.status === 'running' ? 'badge-success' :
                        container.status === 'stopped' ? 'badge-gray' :
                        'badge-error'
                      }`}>
                        {container.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {container.owner?.username}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {container.owner?.role}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {new Date(container.createdAt).toLocaleDateString('id-ID')}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(container.createdAt).toLocaleTimeString('id-ID')}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <Link
                          to={`/containers/${container.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </Link>
                        {container.status === 'running' ? (
                          <button className="btn btn-ghost btn-sm text-warning-600">
                            <StopIcon className="h-4 w-4" />
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm text-success-600">
                            <PlayIcon className="h-4 w-4" />
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm text-error-600">
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body text-center py-12">
            <ServerIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              Belum ada container
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Mulai dengan membuat container pertama Anda.
            </p>
            <div className="mt-6">
              <Link to="/containers/create" className="btn btn-primary">
                <PlusIcon className="h-4 w-4 mr-2" />
                Buat Container
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Menampilkan {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.total)} dari {pagination.total} container
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="btn btn-outline btn-sm"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page === pagination.totalPages}
              className="btn btn-outline btn-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ContainersPage
