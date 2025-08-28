import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useThemeStore = create(
  persist(
    (set, get) => ({
      // State
      theme: 'light', // 'light' | 'dark' | 'system'
      systemTheme: 'light',

      // Actions
      setTheme: (theme) => {
        set({ theme })
        get().applyTheme(theme)
      },

      toggleTheme: () => {
        const { theme } = get()
        const newTheme = theme === 'light' ? 'dark' : 'light'
        get().setTheme(newTheme)
      },

      initializeTheme: () => {
        const { theme } = get()
        
        // Detect system theme
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        set({ systemTheme })
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
          const newSystemTheme = e.matches ? 'dark' : 'light'
          set({ systemTheme: newSystemTheme })
          
          // If theme is set to system, apply the new system theme
          if (get().theme === 'system') {
            get().applyTheme('system')
          }
        })
        
        // Apply current theme
        get().applyTheme(theme)
      },

      applyTheme: (theme) => {
        const { systemTheme } = get()
        let effectiveTheme = theme
        
        if (theme === 'system') {
          effectiveTheme = systemTheme
        }
        
        // Apply theme to document
        if (effectiveTheme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
        
        // Update meta theme-color
        const metaThemeColor = document.querySelector('meta[name="theme-color"]')
        if (metaThemeColor) {
          metaThemeColor.setAttribute('content', effectiveTheme === 'dark' ? '#1f2937' : '#3b82f6')
        }
      },

      getEffectiveTheme: () => {
        const { theme, systemTheme } = get()
        return theme === 'system' ? systemTheme : theme
      },

      isDark: () => {
        return get().getEffectiveTheme() === 'dark'
      },

      isLight: () => {
        return get().getEffectiveTheme() === 'light'
      },
    }),
    {
      name: 'theme-storage',
      partialize: (state) => ({
        theme: state.theme,
      }),
    }
  )
)

export { useThemeStore }
