import type { AgentixEvent } from "../../shared/types";

type EventHandler<T extends AgentixEvent = AgentixEvent> = (event: T) => void | Promise<void>;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private history: AgentixEvent[] = [];
  private maxHistory = 1000;

  on<T extends AgentixEvent["type"]>(
    eventType: T,
    handler: EventHandler<Extract<AgentixEvent, { type: T }>>
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
    return () => this.handlers.get(eventType)?.delete(handler as EventHandler);
  }

  onAny(handler: EventHandler): () => void {
    if (!this.handlers.has("*")) {
      this.handlers.set("*", new Set());
    }
    this.handlers.get("*")!.add(handler);
    return () => this.handlers.get("*")?.delete(handler);
  }

  async emit(event: AgentixEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    const specific = this.handlers.get(event.type);
    if (specific) {
      for (const handler of specific) {
        try {
          await handler(event);
        } catch (e) {
          console.error(`EventBus handler error for ${event.type}:`, e);
        }
      }
    }

    const any = this.handlers.get("*");
    if (any) {
      for (const handler of any) {
        try {
          await handler(event);
        } catch (e) {
          console.error(`EventBus wildcard handler error:`, e);
        }
      }
    }
  }

  getHistory(limit?: number): AgentixEvent[] {
    if (limit) return this.history.slice(-limit);
    return [...this.history];
  }

  getHistoryByType(type: AgentixEvent["type"], limit?: number): AgentixEvent[] {
    const filtered = this.history.filter((e) => e.type === type);
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  clearHistory(): void {
    this.history = [];
  }
}

let _bus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!_bus) _bus = new EventBus();
  return _bus;
}
