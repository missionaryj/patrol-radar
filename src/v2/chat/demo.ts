// In-memory stand-in for ChatClient, used only with ?chatdemo (screenshots / UI testing without a Supabase project).
import type { ChatMsg } from './client';
const t = (min: number) => new Date(Date.now() - min * 60000).toISOString();
export class DemoChat {
  uid = 'me'; private terms = new URLSearchParams(location.search).has('agreed'); private cb?: (m: ChatMsg) => void; private n = 100;
  private data: ChatMsg[] = [
    { id: 1, room: '', user_id: 'a', display_name: 'Teal Fox', body: 'Flock camera on Neil St is back up, saw it light up on the map.', created_at: t(42) },
    { id: 2, room: '', user_id: 'b', display_name: 'Amber Owl', body: 'Anyone else getting Axon hits near campus tonight?', created_at: t(31) },
    { id: 3, room: '', user_id: 'c', display_name: 'Slate Heron', body: 'Yeah, 2 weak ones on Green around 7:50.', created_at: t(27) },
  ];
  async signIn() {}
  async hasTerms() { return this.terms; }
  async acceptTerms() { this.terms = true; }
  async recent(room: string) { return this.data.map(m => ({ ...m, room })); }
  subscribe(_r: string, on: (m: ChatMsg) => void, del?: (id: number) => void) { this.cb = on; this.del = del; }
  unsubscribe() { this.cb = undefined; }
  async post(room: string, body: string) { this.cb?.({ id: ++this.n, room, user_id: 'me', display_name: 'Coral Hawk', body, created_at: new Date().toISOString() }); }
  private del?: (id: number) => void;
  async remove(id: number) { this.del?.(id); }
  async report() {}
  async block() {}
  async blocked() { return new Set<string>(); }
}
