import type { EnrichedEvent, FrameworkDataApi } from '../types'

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
        {label}
      </div>
      <div className="whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs leading-relaxed max-h-40 overflow-y-auto">
        {value}
      </div>
    </div>
  )
}

function Usage({ usage }: { usage: Record<string, any> }) {
  const cells: Array<[string, unknown]> = [
    ['input', usage.input_tokens],
    ['output', usage.output_tokens],
    ['cache read', usage.cache_read_tokens],
    ['total', usage.total_tokens],
  ]
  const shown = cells.filter(([, v]) => typeof v === 'number')
  if (shown.length === 0) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
        Tokens
      </div>
      <div className="grid grid-cols-4 gap-2">
        {shown.map(([k, v]) => (
          <div key={k} className="rounded bg-muted/30 px-2 py-1">
            <div className="text-[10px] text-muted-foreground/70">{k}</div>
            <div className="text-xs font-mono">{(v as number).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Hermes detail view: surface the human-meaningful fields (messages, tool
 * args/results, token usage) above the full raw payload, which is kept for
 * completeness since Hermes payloads carry a lot of context.
 */
export function HermesEventDetail({ event }: { event: EnrichedEvent; dataApi: FrameworkDataApi }) {
  const p = event.payload as Record<string, any>
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

  const userMessage = text(p.user_message)
  const assistantResponse = text(p.assistant_response)
  const responseText = text(p.response_text)
  const toolResult = text(p.result)
  const usage = p.usage && typeof p.usage === 'object' ? (p.usage as Record<string, any>) : null

  return (
    <div className="space-y-2.5">
      {userMessage && <TextBlock label="User message" value={userMessage} />}
      {assistantResponse && <TextBlock label="Assistant response" value={assistantResponse} />}
      {responseText && !assistantResponse && <TextBlock label="Output" value={responseText} />}
      {p.tool_name && (
        <TextBlock
          label="Tool"
          value={`${p.tool_name}${p.args ? `\n${JSON.stringify(p.args, null, 2)}` : ''}`}
        />
      )}
      {toolResult && <TextBlock label="Result" value={toolResult} />}
      {usage && <Usage usage={usage} />}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">
          Raw payload
        </div>
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed max-h-60 overflow-y-auto">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  )
}
