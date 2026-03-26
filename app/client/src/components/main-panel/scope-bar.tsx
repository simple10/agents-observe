import { useAgents } from '@/hooks/use-agents';
import { useUIStore } from '@/stores/ui-store';
import { Badge } from '@/components/ui/badge';
import { X, CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAgentDisplayName } from '@/lib/agent-utils';
import type { Agent } from '@/types';

export function ScopeBar() {
  const {
    selectedProjectId,
    selectedSessionId,
    selectedAgentIds,
    removeAgentId,
    toggleAgentId,
  } = useUIStore();
  const { data: agents } = useAgents(selectedSessionId);

  if (!selectedProjectId || !selectedSessionId) return null;

  const allAgents: Agent[] = [];
  function collectAgents(list: Agent[] | undefined) {
    list?.forEach((a) => {
      allAgents.push(a);
      if (a.children) collectAgents(a.children);
    });
  }
  collectAgents(agents);

  const visibleAgents =
    selectedAgentIds.length > 0
      ? allAgents.filter((a) => selectedAgentIds.includes(a.id))
      : allAgents;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border min-h-[40px] flex-wrap">
      <span className="text-xs text-muted-foreground">Agents:</span>

      <div className="flex items-center gap-1 flex-wrap">
        {visibleAgents.map((agent) => {
          const isSubagent = agent.parentAgentId !== null;
          const isSelected = selectedAgentIds.includes(agent.id);
          return (
            <Badge
              key={agent.id}
              variant="secondary"
              className={cn(
                'gap-1 text-xs cursor-pointer select-none',
                agent.status === 'active' ? 'border-green-500/30' : '',
                isSelected ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40' : ''
              )}
              onClick={() => toggleAgentId(agent.id)}
            >
              {isSubagent && <CornerDownRight className="h-2.5 w-2.5" />}
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  agent.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'
                )}
              />
              {getAgentDisplayName(agent)}
              {selectedAgentIds.length > 0 && (
                <button
                  className="ml-0.5 hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); removeAgentId(agent.id); }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </Badge>
          );
        })}
        {visibleAgents.length === 0 && (
          <span className="text-xs text-muted-foreground/60">No agents</span>
        )}
      </div>
    </div>
  );
}
