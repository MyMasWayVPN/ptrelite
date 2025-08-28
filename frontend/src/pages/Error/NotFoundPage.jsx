import { Link } from 'react-router-dom'
import { HomeIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'

const NotFoundPage = () => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          {/* 404 Illustration */}
          <div className="mx-auto h-24 w-24 text-primary-600 dark:text-primary-400">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-full h-full">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.291-1.007-5.691-2.709M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>

          {/* Error Message */}
          <h1 className="mt-6 text-6xl font-bold text-gray-900 dark:text-white">
            404
          </h1>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
            Halaman Tidak Ditemukan
          </h2>
          <p className="mt-4 text-base text-gray-600 dark:text-gray-400 max-w-md mx-auto">
            Maaf, halaman yang Anda cari tidak dapat ditemukan. Mungkin halaman telah dipindahkan atau URL salah.
          </p>

          {/* Action Buttons */}
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => window.history.back()}
              className="btn btn-outline"
            >
              <ArrowLeftIcon className="h-4 w-4 mr-2" />
              Kembali
            </button>
            <Link to="/dashboard" className="btn btn-primary">
              <HomeIcon className="h-4 w-4 mr-2" />
              Ke Dashboard
            </Link>
          </div>

          {/* Help Links */}
          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-8">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Butuh bantuan? Coba link berikut:
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              <Link 
                to="/containers" 
                className="text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
              >
                Container
              </Link>
              <Link 
                to="/profile" 
                className="text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
              >
                Profil
              </Link>
              <a 
                href="mailto:support@panel.com" 
                className="text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
              >
                Kontak Support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage
