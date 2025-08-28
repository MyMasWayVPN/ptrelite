import { useParams } from 'react-router-dom'

const FileManagerPage = () => {
  const { id } = useParams()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          File Manager
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Kelola file untuk container ID: {id}
        </p>
      </div>

      <div className="card">
        <div className="card-body">
          <p className="text-gray-600 dark:text-gray-400">
            Halaman file manager sedang dalam pengembangan.
          </p>
        </div>
      </div>
    </div>
  )
}

export default FileManagerPage
