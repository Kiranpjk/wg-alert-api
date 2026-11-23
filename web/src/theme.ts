import { useEffect, useState } from 'react'
import { readStored, writeStored } from './storage'

const key = 'wg-alert:theme'
const preference = '(prefers-color-scheme: dark)'
type Theme = 'light' | 'dark'

export function useTheme() {
  const [override, setOverride] = useState<Theme | null>(() => {
    const saved = readStored(key)
    return saved === 'light' || saved === 'dark' ? saved : null
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(preference).matches ?? false)
  const theme = override ?? (systemDark ? 'dark' : 'light')

  useEffect(() => {
    const media = window.matchMedia?.(preference)
    const update = () => setSystemDark(media.matches)
    media?.addEventListener('change', update)
    return () => media?.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14130F' : '#F5F2EC')
  }, [theme])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    setOverride(next)
    writeStored(key, next)
  }

  return { theme, toggle }
}
