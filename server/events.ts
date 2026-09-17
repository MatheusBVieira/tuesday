import { EventEmitter } from 'node:events';
import type { ChangeEvent } from '../shared/types';

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function notifyChange(event: ChangeEvent): void {
  bus.emit('change', event);
}

export function onChange(listener: (event: ChangeEvent) => void): () => void {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}
