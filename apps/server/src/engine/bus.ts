import { EventEmitter } from 'node:events';

/**
 * Bus d'évènements interne, relayé vers l'interface par un flux SSE.
 * Il ne transporte que des identifiants et des statuts, jamais de données
 * personnelles: le navigateur recharge les détails par l'API si besoin.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export type BusEvent =
  | { channel: 'request'; payload: Record<string, unknown> }
  | { channel: 'event'; payload: Record<string, unknown> }
  | { channel: 'job'; payload: Record<string, unknown> }
  | { channel: 'campaign'; payload: Record<string, unknown> }
  | { channel: 'notice'; payload: { level: 'info' | 'warn' | 'error'; message: string } };

export function notify(level: 'info' | 'warn' | 'error', message: string): void {
  bus.emit('notice', { level, message });
}
