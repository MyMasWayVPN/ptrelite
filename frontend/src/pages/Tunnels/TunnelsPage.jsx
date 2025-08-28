import { useParams } from 'react-router-dom'

const TunnelsPage = () => {
  const { id } = useParams()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Cloudflare Tunnels
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Kelola tunnel untuk container ID: {id}
        </p>
      </div>

      <div className="card">
        <div className="card-body">
          <p className="text-gray-600 dark:text-gray-400">
            Halaman Cloudflare tunnels sedang dalam pengembangan.
          </p>
        </div>
      </div>
    </div>
  )
}

export default TunnelsPage
