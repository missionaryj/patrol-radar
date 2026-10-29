export * from './types'; export * from './matcher'; export * from './signatures'; export * from './errors'; export * from './detect';
import { MockScanner } from './mockScanner'; import { WebBluetoothScanner } from './webBluetoothScanner'; import { BluefyScanner } from './bluefyScanner'; import { NativeScanner } from './nativeScanner';
import type { BackendKind } from './detect';
import { rotateSalt } from '../util/hash';
/** New scanner = new scan session: rotate the device-id salt so ids never repeat across sessions. */
export function createScanner(kind: BackendKind) { rotateSalt(); return kind === 'native' ? new NativeScanner() : kind === 'web' ? new WebBluetoothScanner() : kind === 'bluefy' ? new BluefyScanner() : new MockScanner(); }
