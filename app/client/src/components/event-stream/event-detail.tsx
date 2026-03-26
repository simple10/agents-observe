import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import type { ParsedEvent } from '@/types';

interface EventDetailProps {
  event: ParsedEvent;
}

export function EventDetail({ event }: EventDetailProps) {
  const [copied, setCopied] = useState(false);
  const payloadStr = JSON.stringify(event.payload, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(payloadStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const chat = (event.payload as any).message?.chat || (event.payload as any).chat;

  return (
    <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs space-y-2">
      {event.toolName && (
        <div>
          <span className="text-muted-foreground">Tool: </span>
          <span className="font-mono">{event.toolName}</span>
        </div>
      )}

      {Array.isArray(chat) && chat.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1">Chat ({chat.length} messages):</div>
          <div className="max-h-40 overflow-y-auto space-y-1 rounded bg-muted/50 p-2">
            {chat.slice(-10).map((msg: any, i: number) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">
                  {msg.role || msg.type || '?'}:
                </span>
                <span className="truncate">
                  {typeof msg.content === 'string'
                    ? msg.content.slice(0, 200)
                    : typeof msg.message?.content === 'string'
                      ? msg.message.content.slice(0, 200)
                      : '...'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">Payload:</span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
          {payloadStr}
        </pre>
      </div>
    </div>
  );
}
