import type { ReactNode } from 'react'

const shapes: Record<string, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v10H3z M10 20v-6h4v6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2m10-10 2-2"/><circle cx="12" cy="12" r="8" /></>,
  theme: <path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  external: <path d="M13 4h7v7m0-7-9 9m7 0v7H4V6h7" />,
  check: <path d="m4 12 5 5L20 6" />,
}

export function Icon({ name }: { name: keyof typeof shapes }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>
}
