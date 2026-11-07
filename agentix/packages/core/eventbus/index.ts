import type { AgentixEvent } from "../../shared/types";

type EventHandler<T extends AgentixEvent = AgentixEvent> = (event: T) => void | Promise<void>;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private history: AgentixEvent[] = [];
  private maxHistory = 1000;

  /**
   * Subscribes a handler to one event type and returns an unsubscribe function.
   * Why: the only way for a component to react to domain events (e.g. ActionExecuted) without coupling to the emitter.
   * @param eventType The AgentixEvent type to listen for; the handler's event is narrowed to that type.
   * @param handler Invoked in subscription order with the emitted event; may be sync or async.
   * @returns An unsubscribe function — call it to stop receiving events; calling it twice is safe.
   * @throws Nothing — registering never throws.
   * Maps to: event ActionExecuted, SessionCreated, HarnessDetected (any AgentixEvent type a subscriber cares about).
   * Side effects: adds the handler to this bus's registry for the type.
   */
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

  /**
   * Subscribes a handler to every event type ("*" wildcard) and returns an unsubscribe function.
   * Why: for audit logging, diagnostics and debugging, where the subscriber needs the whole stream, not one type.
   * @param handler Invoked for every emitted event, after the type-specific handlers for that event.
   * @returns An unsubscribe function; calling it twice is safe.
   * @throws Nothing.
   * Maps to: event ActionExecuted, SessionCreated, HarnessDetected (the full AgentixEvent stream).
   * Side effects: adds the handler to the "*" registry.
   */
  onAny(handler: EventHandler): () => void {
    if (!this.handlers.has("*")) {
      this.handlers.set("*", new Set());
    }
    this.handlers.get("*")!.add(handler);
    return () => this.handlers.get("*")?.delete(handler);
  }

  /**
   * Records an event in history and delivers it to its type handlers, then to wildcard handlers.
   * Why: the single fan-out point — emitters never call subscribers directly, so a new listener can be added without touching any emitter.
   * @param event The event to deliver; it is appended to history before any handler runs.
   * @returns A promise resolving once every handler has run (or failed — see throws).
   * @throws Nothing — a throwing handler is caught, logged to console.error, and delivery continues to the remaining handlers.
   * Maps to: event ActionExecuted, ReplayBlocked, HarnessDetected (whatever type the caller emits).
   * Side effects: appends to history (capped at the newest 1000 events); runs handlers sequentially in subscription order — a slow handler delays later handlers and the emit caller.
   */
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

  /**
   * Returns the most recent events, newest last.
   * Why: diagnostics and replay need the recent stream without subscribing in advance.
   * @param limit When given, returns only the last `limit` events; 0 or omitted returns the full history (up to 1000).
   * @returns A copy of the history (mutating it does not affect the bus); empty array when nothing was ever emitted.
   * @throws Nothing.
   * Maps to: internal — EventBus.emit (the history it records).
   */
  getHistory(limit?: number): AgentixEvent[] {
    if (limit) return this.history.slice(-limit);
    return [...this.history];
  }

  /**
   * Returns the most recent events of one type, newest last.
   * Why: a caller usually wants one stream (e.g. all ActionExecuted) without filtering the whole history itself.
   * @param type The AgentixEvent type to filter by.
   * @param limit When given, returns only the last `limit` matches; 0 or omitted returns all matches.
   * @returns Matching events in emission order; empty array when none of that type were emitted.
   * @throws Nothing.
   * Maps to: event ActionExecuted, SessionCreated (filtered view of the history EventBus.emit records).
   */
  getHistoryByType(type: AgentixEvent["type"], limit?: number): AgentixEvent[] {
    const filtered = this.history.filter((e) => e.type === type);
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  /**
   * Drops all recorded history (handlers are untouched).
   * Why: tests and long-lived processes need a clean audit slate without tearing down subscriptions.
   * @returns Nothing.
   * @throws Nothing.
   * Maps to: internal — EventBus.getHistory / getHistoryByType (the history it clears).
   * Side effects: history becomes empty; subsequent getHistory calls return [] until new events are emitted.
   */
  clearHistory(): void {
    this.history = [];
  }
}

let _bus: EventBus | null = null;

/**
 * Returns the process-wide EventBus singleton, creating it on first use.
 * Why: every emitter and subscriber must share one bus, or events would silently go nowhere.
 * @returns The shared EventBus instance; the same object on every call.
 * @throws Nothing.
 * Maps to: internal — ToolRouter.route, HarnessManager.scanAll (the emitters that share this bus).
 * Side effects: creates and caches the bus on first call.
 */
export function getEventBus(): EventBus {
  if (!_bus) _bus = new EventBus();
  return _bus;
}
