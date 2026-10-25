import { EventEmitter } from 'node:events';

export type TrackerEvent =
  | { type: 'changed'; batchId: string | null }
  | { type: 'inbox'; fileRowId: string }
  | { type: 'questions' }
  | { type: 'messages' }
  | { type: 'folder'; message: string };

/** In-process bus: the SSE stream and the snapshot writer listen here after each committed write. */
class Bus extends EventEmitter {
  publish(event: TrackerEvent) {
    this.emit('event', event);
  }
  subscribe(fn: (event: TrackerEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
