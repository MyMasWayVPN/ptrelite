import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from 'react-query'
import { ReactQueryDevtools } from 'react-query/devtools'
import { Toaster } from 'react-hot-toast'

import App from './App.jsx'
import './index.css'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 401/403 errors
        if (error?.response?.status === 401 || error?.response?.status === 403) {
          return false
        }
        return failureCount < 3
      },
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
    },
    mutations: {
      retry: false,
    },
  },
})

// Error boundary component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error boundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900 rounded-full mb-4">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white text-center mb-2">
              Terjadi Kesalahan
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-4">
              Aplikasi mengalami kesalahan yang tidak terduga. Silakan muat ulang halaman.
            </p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                Muat Ulang
              </button>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Coba Lagi
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded text-sm">
                <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300">
                  Detail Error (Development)
                </summary>
                <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 overflow-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// Toast configuration
const toastOptions = {
  duration: 4000,
  position: 'top-right',
  style: {
    background: 'var(--toast-bg, #ffffff)',
    color: 'var(--toast-color, #374151)',
    border: '1px solid var(--toast-border, #e5e7eb)',
    borderRadius: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    padding: '12px 16px',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  },
  success: {
    iconTheme: {
      primary: '#10b981',
      secondary: '#ffffff',
    },
  },
  error: {
    iconTheme: {
      primary: '#ef4444',
      secondary: '#ffffff',
    },
  },
  loading: {
    iconTheme: {
      primary: '#3b82f6',
      secondary: '#ffffff',
    },
  },
}

// Main render
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster toastOptions={toastOptions} />
          {process.env.NODE_ENV === 'development' && (
            <ReactQueryDevtools initialIsOpen={false} />
          )}
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
