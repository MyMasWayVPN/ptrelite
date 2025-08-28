import { Fragment } from 'react'
import { Menu, Transition } from '@headlessui/react'
import { 
  Bars3Icon,
  BellIcon,
  MoonIcon,
  SunIcon,
  ComputerDesktopIcon,
  ArrowRightOnRectangleIcon,
  UserIcon,
  CogIcon,
} from '@heroicons/react/24/outline'
import { clsx } from 'clsx'
import { useAuthStore } from '@store/authStore'
import { useThemeStore } from '@store/themeStore'

const Header = ({ onMenuClick }) => {
  const { user, logout } = useAuthStore()
  const { theme, setTheme, toggleTheme } = useThemeStore()

  const handleLogout = async () => {
    await logout()
  }

  const themeOptions = [
    { value: 'light', label: 'Terang', icon: SunIcon },
    { value: 'dark', label: 'Gelap', icon: MoonIcon },
    { value: 'system', label: 'Sistem', icon: ComputerDesktopIcon },
  ]

  const userMenuItems = [
    {
      name: 'Profil',
      href: '/profile',
      icon: UserIcon,
    },
    {
      name: 'Pengaturan',
      href: '/settings',
      icon: CogIcon,
    },
  ]

  return (
    <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
      {/* Mobile menu button */}
      <button
        type="button"
        className="-m-2.5 p-2.5 text-gray-700 dark:text-gray-300 lg:hidden"
        onClick={onMenuClick}
      >
        <span className="sr-only">Buka sidebar</span>
        <Bars3Icon className="h-6 w-6" aria-hidden="true" />
      </button>

      {/* Separator */}
      <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 lg:hidden" aria-hidden="true" />

      <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
        {/* Page title or breadcrumb could go here */}
        <div className="flex flex-1 items-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            {/* This could be dynamic based on current page */}
          </h1>
        </div>

        <div className="flex items-center gap-x-4 lg:gap-x-6">
          {/* Theme selector */}
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center p-2 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300">
              <span className="sr-only">Ubah tema</span>
              {theme === 'light' && <SunIcon className="h-5 w-5" />}
              {theme === 'dark' && <MoonIcon className="h-5 w-5" />}
              {theme === 'system' && <ComputerDesktopIcon className="h-5 w-5" />}
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white dark:bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                {themeOptions.map((option) => (
                  <Menu.Item key={option.value}>
                    {({ active }) => (
                      <button
                        onClick={() => setTheme(option.value)}
                        className={clsx(
                          'flex w-full items-center px-4 py-2 text-sm',
                          active
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                            : 'text-gray-700 dark:text-gray-300',
                          theme === option.value && 'font-medium'
                        )}
                      >
                        <option.icon className="mr-3 h-4 w-4" />
                        {option.label}
                        {theme === option.value && (
                          <span className="ml-auto text-primary-600 dark:text-primary-400">✓</span>
                        )}
                      </button>
                    )}
                  </Menu.Item>
                ))}
              </Menu.Items>
            </Transition>
          </Menu>

          {/* Notifications */}
          <button
            type="button"
            className="relative rounded-full bg-white dark:bg-gray-800 p-1 text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            <span className="sr-only">Lihat notifikasi</span>
            <BellIcon className="h-6 w-6" aria-hidden="true" />
            {/* Notification badge */}
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-error-500 text-xs text-white flex items-center justify-center">
              3
            </span>
          </button>

          {/* Separator */}
          <div className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-200 dark:lg:bg-gray-700" aria-hidden="true" />

          {/* Profile dropdown */}
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-x-2 text-sm">
              <span className="sr-only">Buka menu user</span>
              <div className="h-8 w-8 rounded-full bg-primary-500 flex items-center justify-center">
                <span className="text-white text-sm font-medium">
                  {user?.username?.charAt(0).toUpperCase()}
                </span>
              </div>
              <span className="hidden lg:flex lg:items-center">
                <span className="ml-2 text-sm font-semibold leading-6 text-gray-900 dark:text-white">
                  {user?.username}
                </span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                  {user?.role === 'ADMIN' ? 'Admin' : 'Member'}
                </span>
              </span>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white dark:bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                {userMenuItems.map((item) => (
                  <Menu.Item key={item.name}>
                    {({ active }) => (
                      <a
                        href={item.href}
                        className={clsx(
                          'flex items-center px-4 py-2 text-sm',
                          active
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                            : 'text-gray-700 dark:text-gray-300'
                        )}
                      >
                        <item.icon className="mr-3 h-4 w-4" />
                        {item.name}
                      </a>
                    )}
                  </Menu.Item>
                ))}
                <div className="border-t border-gray-100 dark:border-gray-700" />
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={handleLogout}
                      className={clsx(
                        'flex w-full items-center px-4 py-2 text-sm',
                        active
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                          : 'text-gray-700 dark:text-gray-300'
                      )}
                    >
                      <ArrowRightOnRectangleIcon className="mr-3 h-4 w-4" />
                      Keluar
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </div>
    </div>
  )
}

export default Header
