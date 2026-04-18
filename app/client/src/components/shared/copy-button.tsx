import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  text: string
  /** Label shown in the idle state (replaced by "Copied!" on click). */
  label: ReactNode
  /** Optional icon rendered before the label in the idle state. The
   * green check replaces it in the copied state. */
  icon?: ReactNode
  /** Tooltip shown in the idle state. */
  title?: string
  /** Additional classes merged onto the button. */
  className?: string
  /** How long to show the "Copied!" feedback before reverting. */
  resetMs?: number
}

/**
 * Inline click-to-copy button. Idle styling is caller-controlled via
 * `className`; when omitted it defaults to muted-with-hover-brighten
 * (matching the breadcrumb cwd button). The copied-state classes come
 * last so twMerge forces muted "Copied!" + green check regardless of
 * the caller's idle styling.
 */
export function CopyButton({
  text,
  label,
  icon,
  title,
  className,
  resetMs = 2000,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleClick = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), resetMs)
  }

  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-1 truncate cursor-pointer transition-opacity',
        className ?? 'opacity-60 hover:opacity-100',
        copied && 'opacity-60 hover:opacity-100',
      )}
      onClick={handleClick}
      title={copied ? 'Copied!' : title}
    >
      {copied ? <Check className="h-3 w-3 shrink-0 text-green-500" /> : icon ? icon : null}
      <span className="truncate">{copied ? 'Copied!' : label}</span>
    </button>
  )
}
