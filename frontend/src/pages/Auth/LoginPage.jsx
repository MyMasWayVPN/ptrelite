import { useState, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { useAuthStore } from '@store/authStore'
import LoadingSpinner from '@components/UI/LoadingSpinner'

const LoginPage = () => {
  const [showPassword, setShowPassword] = useState(false)
  const { login, isLoading, user } = useAuthStore()
  const location = useLocation()

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm()

  // Redirect if already authenticated
  if (user) {
    const from = location.state?.from?.pathname || '/dashboard'
    return <Navigate to={from} replace />
  }

  const onSubmit = async (data) => {
    const result = await login(data)
    
    if (!result.success) {
      setError('root', {
        type: 'manual',
        message: result.error,
      })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900">
            <svg className="h-6 w-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Masuk ke Panel
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            Web Hosting Panel - Kelola container Docker Anda
          </p>
        </div>

        {/* Login Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            {/* Username */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Username
              </label>
              <div className="mt-1">
                <input
                  {...register('username', {
                    required: 'Username wajib diisi',
                    minLength: {
                      value: 3,
                      message: 'Username minimal 3 karakter',
                    },
                  })}
                  type="text"
                  autoComplete="username"
                  className={`input ${errors.username ? 'input-error' : ''}`}
                  placeholder="Masukkan username"
                />
                {errors.username && (
                  <p className="mt-1 text-sm text-error-600">{errors.username.message}</p>
                )}
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </label>
              <div className="mt-1 relative">
                <input
                  {...register('password', {
                    required: 'Password wajib diisi',
                    minLength: {
                      value: 6,
                      message: 'Password minimal 6 karakter',
                    },
                  })}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className={`input pr-10 ${errors.password ? 'input-error' : ''}`}
                  placeholder="Masukkan password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5 text-gray-400" />
                  ) : (
                    <EyeIcon className="h-5 w-5 text-gray-400" />
                  )}
                </button>
                {errors.password && (
                  <p className="mt-1 text-sm text-error-600">{errors.password.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Error Message */}
          {errors.root && (
            <div className="rounded-md bg-error-50 dark:bg-error-900/20 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-error-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-error-800 dark:text-error-200">
                    {errors.root.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary w-full"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <LoadingSpinner size="sm" color="white" />
                  <span className="ml-2">Masuk...</span>
                </div>
              ) : (
                'Masuk'
              )}
            </button>
          </div>

          {/* Demo Accounts */}
          <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
            <p className="text-center text-sm text-gray-600 dark:text-gray-400 mb-4">
              Akun Demo untuk Testing:
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-center">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Admin</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">admin / admin123</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-center">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Member</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">member / member123</p>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Web Hosting Panel v1.0.0
          </p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
