import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@/lib/utils'

// Two tab-visibility quirks conspire to make Radix Tooltip misbehave
// around tab-switching; this block patches both:
//
// 1. Tooltips that were open when the tab was hidden never see a
//    pointerleave / blur, so on return Radix still thinks they're
//    open. We dispatch pointerleave + blur on every trigger at the
//    moment the tab becomes hidden so Radix closes them in advance.
//
// 2. Even if nothing was open, the browser re-fires `focus` on the
//    last-focused element when a tab regains visibility. Radix opens
//    the tooltip on focus. For the sidebar's selected session this
//    means "the active session tooltip pops up on tab return even
//    though the pointer is nowhere near it". We catch this by
//    blurring the focused tooltip trigger on a post-visibility rAF
//    (after the browser has fired the spurious focus).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const triggers = document.querySelectorAll('[data-slot="tooltip-trigger"]')
      for (const el of triggers) {
        el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, cancelable: false }))
        el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }))
      }
      return
    }
    // Visible again. After the browser has re-fired focus events,
    // blur any tooltip trigger that the browser restored focus to.
    requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null
      if (active && typeof active.closest === 'function') {
        const trigger = active.closest('[data-slot="tooltip-trigger"]') as HTMLElement | null
        if (trigger) trigger.blur()
      }
    })
  })
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
