/** A received BLE advertisement. Raw device identifiers are reduced to an ephemeral hash before leaving the scanner. */
export interface Advertisement {
  sessionId: string;              // ephemeral salted hash, never the MAC/device id
  name?: string;
  rssi?: number;
  txPower?: number;
  manufacturerData: Map<number, DataView>;
  serviceUuids: string[];
  serviceData: Map<string, DataView>;
  timestamp: number;
  /** Android only: the listed vendor OUI (e.g. "00:25:DF") when the PUBLIC address starts with it. Never the address itself. */
  oui?: string;
}
export type AdvListener = (adv: Advertisement) => void;
/** Passive scanner contract: implementations MUST NOT connect, pair, write or probe. */
export interface Scanner {
  readonly name: string;
  isSupported(): Promise<boolean>;
  start(onAdv: AdvListener): Promise<void>;
  stop(): void;
}
