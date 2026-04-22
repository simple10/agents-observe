import { useEffect } from 'react'

function isTextInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  const htmlEl = el as HTMLElement
  if (htmlEl.isContentEditable || htmlEl.contentEditable === 'true') return true
  return false
}

function focusSearch() {
  const target = document.querySelector<HTMLElement>('[data-region-target="search"]')
  target?.focus()
}

function clickAgentsTrigger() {
  const target = document.querySelector<HTMLElement>('[data-region-target="agents"]')
  target?.click()
}

function focusFirstFilterPill() {
  const target = document.querySelector<HTMLElement>('[data-filter-pill]')
  target?.focus()
}

function focusSidebar() {
  const selected = document.querySelector<HTMLElement>('[data-sidebar-item][aria-current="true"]')
  const target = selected ?? document.querySelector<HTMLElement>('[data-sidebar-item]')
  target?.focus()
}

export function useRegionShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented) return
      if (isTextInputFocused()) return

      switch (e.key) {
        case '/':
          e.preventDefault()
          focusSearch()
          return
        case 'a':
          e.preventDefault()
          clickAgentsTrigger()
          return
        case 't':
          e.preventDefault()
          focusFirstFilterPill()
          return
        case 's':
          e.preventDefault()
          focusSidebar()
          return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
