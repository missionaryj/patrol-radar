import { describe, it, expect } from 'vitest';
import { checkMessage } from './filter';
import { roomFor, type CityRow } from './room';
import { chatConfig } from './client';
import { coarsen } from '../../map/coarsen';
import { readFileSync } from 'fs';
const rows: CityRow[] = JSON.parse(readFileSync('public/data/cities/us.json', 'utf8')).rows;

describe('chat filter', () => {
  it.each([
    ['call me 217-555-1234', 'phone'], ['he lives at 1204 W Main St', 'address'], ['plate ABC 1234', 'plate'],
    ['going to shoot the cop', 'threat'], ['let\u2019s jump that officer', 'threat'], ['mail x@y.com', 'email'], ['a'.repeat(281), 'too long'], ['  ', 'empty'],
  ])('blocks %s', (t, r) => expect(checkMessage(t)).toBe(r));
  it.each(['Flock camera on Neil St is back up', 'Axon hits near campus around 7:50', '2 weak ones on Green St', 'I-74 eastbound is slow'])('allows %s', t => expect(checkMessage(t)).toBeNull());
});
describe('room', () => {
  it('Champaign cell → Champaign room', () => expect(roomFor(coarsen(40.116, -88.243), rows)).toEqual({ key: 'US-IL-champaign', label: 'Champaign, IL' }));
  it('Chicago Loop → Chicago', () => expect(roomFor(coarsen(41.881, -87.63), rows)?.key).toBe('US-IL-chicago'));
  it('room key format matches the DB check', () => expect(roomFor(coarsen(34.05, -118.25), rows)!.key).toMatch(/^[A-Z]{2}-[A-Z0-9]{1,3}-[a-z0-9-]{1,60}$/));
  it('ocean → null', () => expect(roomFor({ lat: 30, lng: -150 }, rows)).toBeNull());
});
describe('config', () => {
  it('missing env → null', () => expect(chatConfig({})).toBeNull());
  it('env present', () => expect(chatConfig({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({ url: 'https://x.supabase.co', key: 'k' }));
});
