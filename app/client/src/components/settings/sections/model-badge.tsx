import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import type { TranscriptStatsModelPricing } from '@/lib/api-client'

/**
 * Format a model id for badge display.
 *
 * Anthropic uses dash-separated version digits (`claude-opus-4-7`) and
 * a trailing date stamp (`-20251001`). We strip the prefix, the date,
 * and convert the version dashes to dots so the badge reads
 * "opus-4.7".
 *
 * Other providers (OpenAI's `gpt-5.4`, Meta's `llama-3.3-70b`, etc.)
 * use whatever shape the provider chose — applying Claude's
 * dash-to-dot rule to them would corrupt the label (e.g. "3-70b" must
 * NOT become "3.70b"). So the regex only fires for claude- ids.
 */
export function formatModelLabel(modelId: string): string {
  if (modelId.startsWith('claude-')) {
    let s = modelId.slice('claude-'.length)
    s = s.replace(/-\d{8}$/, '') // trailing date stamp
    s = s.replace(/(\d)-(\d)/g, '$1.$2') // version dashes → dots
    return s
  }
  return modelId
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function ModelBadge({
  modelId,
  effort,
  pricing,
}: {
  modelId: string
  effort?: string | null
  pricing?: TranscriptStatsModelPricing | null
}) {
  const label = formatModelLabel(modelId)
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="model-badge"
            data-model-id={modelId}
            className="inline-flex items-center text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-blue-300 cursor-help"
          >
            {label}
            {effort ? <span className="ml-1 text-[9px] text-slate-300">{effort}</span> : null}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          // Override the default `bg-primary text-primary-foreground` (which
          // is designed for short label tooltips) with a popover treatment
          // that respects the theme and has enough surface area for our
          // multi-line pricing table.
          className="!bg-popover !text-popover-foreground border border-border max-w-xs p-3 shadow-md"
        >
          <div className="font-mono text-[11px] text-foreground mb-1 break-all">{modelId}</div>
          {effort && (
            <div className="text-[10px] text-muted-foreground mb-2">
              Reasoning effort: <span className="text-foreground">{effort}</span>
            </div>
          )}
          {pricing ? (
            <>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                Pricing · per million tokens
              </div>
              <table className="w-full font-mono text-[11px]">
                <tbody>
                  <tr>
                    <td className="text-muted-foreground py-0.5">Input</td>
                    <td className="text-right text-foreground">{fmtUsd(pricing.inputPerM)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-0.5">Output</td>
                    <td className="text-right text-foreground">{fmtUsd(pricing.outputPerM)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-0.5">Cache read</td>
                    <td className="text-right text-foreground">{fmtUsd(pricing.cacheReadPerM)}</td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-0.5">Cache write (5m)</td>
                    <td className="text-right text-foreground">
                      {fmtUsd(pricing.cacheCreate5mPerM)}
                    </td>
                  </tr>
                  <tr>
                    <td className="text-muted-foreground py-0.5">Cache write (1h)</td>
                    <td className="text-right text-foreground">
                      {fmtUsd(pricing.cacheCreate1hPerM)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2 text-[9px] italic text-muted-foreground">
                Pricing from models.dev · refreshed daily
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground italic">
              Pricing not available for this model.
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
