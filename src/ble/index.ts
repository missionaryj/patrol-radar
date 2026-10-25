export * from './types'; export * from './matcher'; export * from './signatures'; export * from './errors'; export * from './detect';
import { MockScanner } from './mockScanner'; import { WebBluetoothScanner } from './webBluetoothScanner'; import { BluefyScanner } from './bluefyScanner';
import type { BackendKind } from './detect';
export function createScanner(kind: BackendKind) { return kind === 'web' ? new WebBluetoothScanner() : kind === 'bluefy' ? new BluefyScanner() : new MockScanner(); }
