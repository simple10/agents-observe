import { useMemo } from 'react';
import { useEvents } from '@/hooks/use-events';
import { useAgents } from '@/hooks/use-agents';
import { useUIStore } from '@/stores/ui-store';
import { useSessions } from '@/hooks/use-sessions';
import { EventRow } from './event-row';
import type { Agent } from '@/types';

export function EventStream() {
  const {
    selectedProjectId,
    selectedSessionId,
    selectedAgentIds,
    activeEventTypes,
    searchQuery,
  } = useUIStore();

  const { data: sessions } = useSessions(selectedProjectId);
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null;

  const { data: events } = useEvents(effectiveSessionId, {
    agentIds: selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
    search: searchQuery || undefined,
  });

  const { data: agents } = useAgents(effectiveSessionId);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    function collect(list: Agent[] | undefined) {
      list?.forEach((a) => {
        map.set(a.id, a);
        if (a.children) collect(a.children);
      });
    }
    collect(agents);
    return map;
  }, [agents]);

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    if (activeEventTypes.length === 0) return events;
    return events.filter((e) => {
      const matchType = activeEventTypes.includes(e.type);
      const matchSubtype = e.subtype && activeEventTypes.includes(e.subtype);
      return matchType || matchSubtype;
    });
  }, [events, activeEventTypes]);

  const showAgentLabel = agentMap.size > 1;

  if (!effectiveSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    );
  }

  if (!filteredEvents.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No events yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-border/50">
        {filteredEvents.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            agentMap={agentMap}
            showAgentLabel={showAgentLabel}
          />
        ))}
      </div>
    </div>
  );
}
