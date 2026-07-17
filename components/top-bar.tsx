'use client'

import { Moon, Sun } from 'lucide-react'
import { useState, useEffect } from 'react'

interface TopBarProps {
  title: string
}

export function TopBar({ title }: TopBarProps) {
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

  if (!mounted) return null

  return (
    <div className="border-b border-border bg-background px-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium text-foreground">{title}</h1>
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-muted-background flex items-center justify-center text-sm font-medium">
            JD
          </div>
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
        </div>
      </div>
    </div>
  )
}
