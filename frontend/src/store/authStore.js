import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import toast from 'react-hot-toast'
import { authAPI } from '@services/api'

const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Actions
      login: async (credentials) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await authAPI.login(credentials)
          const { user, accessToken } = response.data
          
          // Store token in localStorage for API requests
          localStorage.setItem('accessToken', accessToken)
          
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
          
          toast.success(`Selamat datang, ${user.username}!`)
          return { success: true, user }
        } catch (error) {
          const errorMessage = error.response?.data?.message || 'Login gagal'
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: errorMessage,
          })
          
          toast.error(errorMessage)
          return { success: false, error: errorMessage }
        }
      },

      logout: async () => {
        set({ isLoading: true })
        
        try {
          await authAPI.logout()
        } catch (error) {
          console.error('Logout error:', error)
        } finally {
          // Clear all auth data
          localStorage.removeItem('accessToken')
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          })
          
          toast.success('Berhasil logout')
        }
      },

      checkAuth: async () => {
        const token = localStorage.getItem('accessToken')
        if (!token) {
          set({ isLoading: false })
          return
        }

        set({ isLoading: true })
        
        try {
          const response = await authAPI.getProfile()
          const { user } = response.data
          
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
        } catch (error) {
          // Token might be expired or invalid
          localStorage.removeItem('accessToken')
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          })
        }
      },

      refreshToken: async () => {
        try {
          const response = await authAPI.refreshToken()
          const { user, accessToken } = response.data
          
          localStorage.setItem('accessToken', accessToken)
          set({
            user,
            isAuthenticated: true,
            error: null,
          })
          
          return true
        } catch (error) {
          // Refresh failed, logout user
          get().logout()
          return false
        }
      },

      updateProfile: async (profileData) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await authAPI.updateProfile(profileData)
          const { user } = response.data
          
          set({
            user,
            isLoading: false,
            error: null,
          })
          
          toast.success('Profil berhasil diperbarui')
          return { success: true, user }
        } catch (error) {
          const errorMessage = error.response?.data?.message || 'Gagal memperbarui profil'
          set({
            isLoading: false,
            error: errorMessage,
          })
          
          toast.error(errorMessage)
          return { success: false, error: errorMessage }
        }
      },

      changePassword: async (passwordData) => {
        set({ isLoading: true, error: null })
        
        try {
          await authAPI.changePassword(passwordData)
          
          set({
            isLoading: false,
            error: null,
          })
          
          toast.success('Password berhasil diubah')
          return { success: true }
        } catch (error) {
          const errorMessage = error.response?.data?.message || 'Gagal mengubah password'
          set({
            isLoading: false,
            error: errorMessage,
          })
          
          toast.error(errorMessage)
          return { success: false, error: errorMessage }
        }
      },

      clearError: () => {
        set({ error: null })
      },

      // Utility functions
      hasRole: (role) => {
        const { user } = get()
        return user?.role === role
      },

      isAdmin: () => {
        const { user } = get()
        return user?.role === 'ADMIN'
      },

      isMember: () => {
        const { user } = get()
        return user?.role === 'MEMBER'
      },

      canAccessContainer: (container) => {
        const { user } = get()
        if (!user) return false
        
        // Admin can access all containers
        if (user.role === 'ADMIN') return true
        
        // Member can only access their own containers
        return container.ownerId === user.id
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

export { useAuthStore }
