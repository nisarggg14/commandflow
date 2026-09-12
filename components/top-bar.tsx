'use client'

import { LogOut, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface TopBarProps { title: string; user?: { name: string; email: string; role: string; company?: { name: string } } | null }

export function TopBar({ title, user }: TopBarProps) {
  const router = useRouter(); const [theme, setTheme] = useState<'light' | 'dark'>('dark'); const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true); setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light') }, [])
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; document.documentElement.classList.toggle('dark', next === 'dark'); document.documentElement.classList.toggle('light', next === 'light'); setTheme(next) }
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login') }
  return <header className="flex min-h-[4.5rem] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:px-7"><div className="min-w-0"><p className="cf-kicker hidden sm:block">Workspace / Command center</p><h1 className="truncate text-base font-semibold tracking-tight md:text-lg">{title}</h1></div><div className="flex items-center gap-2 md:gap-4">{user && <div className="hidden items-center gap-3 border-l border-border pl-4 sm:flex"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">{user.name.charAt(0).toUpperCase()}</div><div className="leading-tight"><p className="text-sm font-medium">{user.name}</p><p className="text-[11px] text-muted-foreground">{user.role} · {user.company?.name || 'Company'}</p></div></div>}{user?.role === 'ADMIN' && <button onClick={() => router.push('/admin')} className="cf-button hidden px-3 py-1.5 text-xs sm:inline-flex"><ShieldCheck className="h-3.5 w-3.5" /> Admin</button>}{mounted && <button onClick={toggleTheme} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>}<button onClick={logout} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="Sign out"><LogOut className="h-4 w-4" /></button></div></header>
}
