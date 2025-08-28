import { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { NavLink, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  XMarkIcon,
  HomeIcon,
  ServerIcon,
  CommandLineIcon,
  FolderIcon,
  CloudIcon,
  UserIcon,
  UsersIcon,
  DocumentTextIcon,
  CogIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline'
import { useAuthStore } from '@store/authStore'

const Sidebar = ({ open = false, onClose = () => {}, mobile = false }) => {
  const { user } = useAuthStore()
  const location = useLocation()

  // Navigation items based on user role
  const getNavigationItems = () => {
    const baseItems = [
      {
        name: 'Dashboard',
        href: '/dashboard',
        icon: HomeIcon,
      },
      {
        name: 'Container',
        href: '/containers',
        icon: ServerIcon,
      },
      {
        name: 'Profil',
        href: '/profile',
        icon: UserIcon,
      },
    ]

    if (user?.role === 'ADMIN') {
      return [
        ...baseItems,
        {
          name: 'Admin Panel',
          href: '/admin',
          icon: ShieldCheckIcon,
        },
        {
          name: 'Kelola User',
          href: '/admin/users',
          icon: UsersIcon,
        },
        {
          name: 'Semua Container',
          href: '/admin/containers',
          icon: ServerIcon,
        },
        {
          name: 'Log Sistem',
          href: '/admin/logs',
          icon: DocumentTextIcon,
        },
        {
          name: 'Pengaturan',
          href: '/admin/settings',
          icon: CogIcon,
        },
      ]
    }

    if (user?.role === 'MEMBER') {
      return [
        {
          name: 'Dashboard',
          href: '/member',
          icon: HomeIcon,
        },
        ...baseItems.slice(1), // Skip dashboard, use member dashboard
      ]
    }

    return baseItems
  }

  const navigation = getNavigationItems()

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center h-16 flex-shrink-0 px-4 bg-primary-600">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="h-8 w-8 bg-white rounded-lg flex items-center justify-center">
              <ServerIcon className="h-5 w-5 text-primary-600" />
            </div>
          </div>
          <div className="ml-3">
            <h1 className="text-white text-lg font-semibold">Panel</h1>
            <p className="text-primary-200 text-xs">Web Hosting</p>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="px-4 py-3 bg-primary-700">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className="h-8 w-8 bg-primary-500 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="ml-3">
            <p className="text-white text-sm font-medium">{user?.username}</p>
            <p className="text-primary-200 text-xs">
              {user?.role === 'ADMIN' ? 'Administrator' : 'Member'}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href || 
            (item.href !== '/dashboard' && location.pathname.startsWith(item.href))
          
          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={mobile ? onClose : undefined}
              className={clsx(
                'sidebar-nav-item',
                isActive ? 'active' : ''
              )}
            >
              <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {item.name}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-gray-200 dark:border-gray-700">
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          Panel v1.0.0
        </div>
      </div>
    </div>
  )

  if (mobile) {
    return (
      <Transition.Root show={open} as={Fragment}>
        <Dialog as="div" className="relative z-50 lg:hidden" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="transition-opacity ease-linear duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-linear duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-gray-900/80" />
          </Transition.Child>

          <div className="fixed inset-0 flex">
            <Transition.Child
              as={Fragment}
              enter="transition ease-in-out duration-300 transform"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="transition ease-in-out duration-300 transform"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <Dialog.Panel className="relative mr-16 flex w-full max-w-xs flex-1">
                <Transition.Child
                  as={Fragment}
                  enter="ease-in-out duration-300"
                  enterFrom="opacity-0"
                  enterTo="opacity-100"
                  leave="ease-in-out duration-300"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >
                  <div className="absolute left-full top-0 flex w-16 justify-center pt-5">
                    <button
                      type="button"
                      className="-m-2.5 p-2.5"
                      onClick={onClose}
                    >
                      <span className="sr-only">Tutup sidebar</span>
                      <XMarkIcon className="h-6 w-6 text-white" aria-hidden="true" />
                    </button>
                  </div>
                </Transition.Child>
                
                <div className="sidebar flex grow flex-col gap-y-5 overflow-y-auto px-6 pb-2">
                  <SidebarContent />
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition.Root>
    )
  }

  return (
    <div className="sidebar flex grow flex-col gap-y-5 overflow-y-auto">
      <SidebarContent />
    </div>
  )
}

export default Sidebar
