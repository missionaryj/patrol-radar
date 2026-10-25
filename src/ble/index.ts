export * from './types'; export * from './matcher'; export * from './signatures';
import { MockScanner } from './mockScanner'; import { WebBluetoothScanner } from './webBluetoothScanner';
export function createScanner(kind: 'mock' | 'web') { return kind === 'web' ? new WebBluetoothScanner() : new MockScanner(); }
