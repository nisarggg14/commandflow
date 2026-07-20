'use client'

import { Moon, Sun, LogOut } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface TopBarProps {
  title: string
  user?: {
    name: string
    email: string
    role: string
    company?: {
      name: string
    }
  } | null
}

export function TopBar({ title, user }: TopBarProps) {
  const router = useRouter()
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const isDark = document.documentElement.classList.contains('dark') || 
                   window.matchMedia('(prefers-color-scheme: dark)').matches
    setTheme(isDark ? 'dark' : 'light')
  }, [])

  const toggleTheme = () => {
    if (!mounted) return
    const html = document.documentElement
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    
    if (newTheme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
    
    setTheme(newTheme)
  }

  const handleLogout = async () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  if (!mounted) return null

  return (
    <div className="border-b border-border bg-background px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium text-foreground">{title}</h1>
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-3 rounded-full border border-border bg-muted-background px-3 py-2 text-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="hidden text-left sm:block">
                <p className="font-medium text-foreground">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.role} • {user.company?.name || 'Company'}</p>
              </div>
            </div>
          ) : null}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-muted-background transition-colors text-muted-foreground hover:text-foreground"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-muted-background transition-colors text-muted-foreground hover:text-foreground"
            title="Logout"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
