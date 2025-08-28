import axios from 'axios'
import toast from 'react-hot-toast'

// Create axios instance
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  withCredentials: true,
})

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle errors and token refresh
api.interceptors.response.use(
  (response) => {
    return response
  },
  async (error) => {
    const originalRequest = error.config

    // Handle 401 errors (unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        // Try to refresh token
        const refreshResponse = await api.post('/auth/refresh')
        const { accessToken } = refreshResponse.data
        
        // Update token in localStorage
        localStorage.setItem('accessToken', accessToken)
        
        // Retry original request with new token
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        // Refresh failed, redirect to login
        localStorage.removeItem('accessToken')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    // Handle other errors
    if (error.response?.status >= 500) {
      toast.error('Terjadi kesalahan server. Silakan coba lagi.')
    } else if (error.response?.status === 403) {
      toast.error('Anda tidak memiliki izin untuk melakukan aksi ini.')
    } else if (error.response?.status === 404) {
      toast.error('Resource tidak ditemukan.')
    } else if (error.response?.status === 429) {
      toast.error('Terlalu banyak permintaan. Silakan tunggu sebentar.')
    } else if (error.code === 'ECONNABORTED') {
      toast.error('Koneksi timeout. Silakan coba lagi.')
    } else if (!error.response) {
      toast.error('Tidak dapat terhubung ke server.')
    }

    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  refreshToken: () => api.post('/auth/refresh'),
  getProfile: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/member/profile', data),
  changePassword: (data) => api.put('/auth/change-password', data),
  getSessions: () => api.get('/auth/sessions'),
  revokeSession: (sessionId) => api.delete(`/auth/sessions/${sessionId}`),
}

// Container API
export const containerAPI = {
  getContainers: (params) => api.get('/containers', { params }),
  getContainer: (id) => api.get(`/containers/${id}`),
  createContainer: (data) => api.post('/containers', data),
  updateContainer: (id, data) => api.put(`/containers/${id}`, data),
  deleteContainer: (id, force = false) => api.delete(`/containers/${id}`, { params: { force } }),
  startContainer: (id) => api.post(`/containers/${id}/start`),
  stopContainer: (id, timeout = 10) => api.post(`/containers/${id}/stop`, { timeout }),
  restartContainer: (id, timeout = 10) => api.post(`/containers/${id}/restart`, { timeout }),
  getContainerStats: (id) => api.get(`/containers/${id}/stats`),
  getContainerLogs: (id, params) => api.get(`/containers/${id}/logs`, { params }),
  getAllowedImages: () => api.get('/containers/images/allowed'),
}

// File Manager API
export const fileAPI = {
  listFiles: (containerId, path = '/') => api.get(`/files/${containerId}`, { params: { path } }),
  getFileContent: (containerId, path) => api.get(`/files/${containerId}/content`, { params: { path } }),
  createFile: (containerId, data) => api.post(`/files/${containerId}`, data),
  updateFileContent: (containerId, data) => api.put(`/files/${containerId}/content`, data),
  renameFile: (containerId, data) => api.put(`/files/${containerId}/rename`, data),
  deleteFile: (containerId, data) => api.delete(`/files/${containerId}`, { data }),
  uploadFiles: (containerId, formData, onUploadProgress) => 
    api.post(`/files/${containerId}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }),
  downloadFile: (containerId, path) => 
    api.get(`/files/${containerId}/download`, { 
      params: { path },
      responseType: 'blob',
    }),
  createArchive: (containerId, data) => api.post(`/files/${containerId}/archive`, data),
  extractArchive: (containerId, data) => api.post(`/files/${containerId}/extract`, data),
}

// Tunnel API
export const tunnelAPI = {
  getTunnels: (containerId) => api.get(`/tunnels/${containerId}`),
  getTunnel: (containerId, tunnelId) => api.get(`/tunnels/${containerId}/${tunnelId}`),
  createTunnel: (containerId, data) => api.post(`/tunnels/${containerId}`, data),
  updateTunnel: (containerId, tunnelId, data) => api.put(`/tunnels/${containerId}/${tunnelId}`, data),
  deleteTunnel: (containerId, tunnelId) => api.delete(`/tunnels/${containerId}/${tunnelId}`),
  startTunnel: (containerId, tunnelId) => api.post(`/tunnels/${containerId}/${tunnelId}/start`),
  stopTunnel: (containerId, tunnelId) => api.post(`/tunnels/${containerId}/${tunnelId}/stop`),
  getTunnelLogs: (containerId, tunnelId, params) => api.get(`/tunnels/${containerId}/${tunnelId}/logs`, { params }),
  testTunnel: (containerId, tunnelId) => api.post(`/tunnels/${containerId}/${tunnelId}/test`),
}

// Member API
export const memberAPI = {
  getDashboard: () => api.get('/member/dashboard'),
  getProfile: () => api.get('/member/profile'),
  updateProfile: (data) => api.put('/member/profile', data),
  changePassword: (data) => api.put('/member/change-password', data),
  getContainers: (params) => api.get('/member/containers', { params }),
  getContainer: (id) => api.get(`/member/containers/${id}`),
  getLogs: (params) => api.get('/member/logs', { params }),
  getSessions: () => api.get('/member/sessions'),
  revokeSession: (sessionId) => api.delete(`/member/sessions/${sessionId}`),
  getStats: () => api.get('/member/stats'),
}

// Admin API
export const adminAPI = {
  // Users
  getUsers: (params) => api.get('/admin/users', { params }),
  getUser: (id) => api.get(`/admin/users/${id}`),
  createUser: (data) => api.post('/admin/users', data),
  updateUser: (id, data) => api.put(`/admin/users/${id}`, data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  resetUserPassword: (id, data) => api.post(`/admin/users/${id}/reset-password`, data),

  // Containers
  getContainers: (params) => api.get('/admin/containers', { params }),
  deleteContainer: (id) => api.delete(`/admin/containers/${id}`),

  // System
  getStats: () => api.get('/admin/stats'),
  getLogs: (params) => api.get('/admin/logs', { params }),
  getSettings: () => api.get('/admin/settings'),
  updateSetting: (key, data) => api.put(`/admin/settings/${key}`, data),
}

// Health API
export const healthAPI = {
  getHealth: () => api.get('/health'),
  getDetailedHealth: () => api.get('/health/detailed'),
  getDatabaseHealth: () => api.get('/health/database'),
  getRedisHealth: () => api.get('/health/redis'),
  getDockerHealth: () => api.get('/health/docker'),
  getMetrics: () => api.get('/health/metrics'),
}

// Utility functions
export const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`
  } else {
    return `${secs}s`
  }
}

export default api
