export type EventBusHandler<T> = (payload: T) => void;

export class EventBus<T = unknown> {
  private subscribers = new Map<string, Set<EventBusHandler<T>>>();

  subscribe(topic: string, handler: EventBusHandler<T>) {
    const set = this.subscribers.get(topic) ?? new Set<EventBusHandler<T>>();
    set.add(handler);
    this.subscribers.set(topic, set);
    return () => this.unsubscribe(topic, handler);
  }

  unsubscribe(topic: string, handler: EventBusHandler<T>) {
    const set = this.subscribers.get(topic);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this.subscribers.delete(topic);
    }
  }

  publish(topic: string, payload: T) {
    const set = this.subscribers.get(topic);
    if (!set) return;
    for (const handler of set) {
      handler(payload);
    }
  }
}
