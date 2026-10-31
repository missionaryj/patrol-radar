import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
export interface ChatMsg { id: number; room: string; user_id: string; display_name: string; body: string; created_at: string }
export const TERMS_VERSION = 1;

export function chatConfig(env: Record<string, string | undefined> = import.meta.env as any) {
  const url = env.VITE_SUPABASE_URL?.trim(), key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Thin wrapper over supabase-js. All writes rely on RLS + triggers in supabase/migrations. */
export class ChatClient {
  uid = '';
  private ch?: RealtimeChannel;
  constructor(private sb: SupabaseClient) {}
  static async create(cfg: { url: string; key: string }) {
    const { createClient } = await import('@supabase/supabase-js');
    return new ChatClient(createClient(cfg.url, cfg.key, { auth: { persistSession: true, storageKey: 'pr.chat.auth' } }));
  }
  async signIn() {
    const { data } = await this.sb.auth.getSession();
    if (data.session) { this.uid = data.session.user.id; return; }
    const r = await this.sb.auth.signInAnonymously();
    if (r.error) throw r.error; this.uid = r.data.user!.id;
  }
  async hasTerms() {
    const { data, error } = await this.sb.from('terms_acceptances').select('version').eq('version', TERMS_VERSION).limit(1);
    if (error) throw error; return (data ?? []).length > 0;
  }
  async acceptTerms() { const { error } = await this.sb.from('terms_acceptances').insert({ version: TERMS_VERSION }); if (error && error.code !== '23505') throw error; }
  async recent(room: string): Promise<ChatMsg[]> {
    const { data, error } = await this.sb.from('messages').select('id,room,user_id,display_name,body,created_at').eq('room', room).order('created_at', { ascending: false }).limit(100);
    if (error) throw error; return (data ?? []).reverse();
  }
  subscribe(room: string, onMsg: (m: ChatMsg) => void, onDelete: (id: number) => void) {
    this.unsubscribe();
    this.ch = this.sb.channel(`room:${room}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${room}` }, p => onMsg(p.new as ChatMsg))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, p => onDelete((p.old as any).id))
      .subscribe();
  }
  unsubscribe() { if (this.ch) { void this.sb.removeChannel(this.ch); this.ch = undefined; } }
  async post(room: string, body: string) { const { error } = await this.sb.from('messages').insert({ room, body }); if (error) throw new Error(error.message); }
  async remove(id: number) { const { error } = await this.sb.from('messages').delete().eq('id', id).eq('user_id', this.uid); if (error) throw new Error(error.message); }
  async report(m: ChatMsg, kind: 'message' | 'user', reason?: string) {
    // no .select(): reporters can't read reports (RLS), so we use return=minimal
    const { error } = await this.sb.from('reports').insert({ message_id: m.id, reported_user: m.user_id, kind, reason });
    if (error && error.code !== '23505') throw new Error(error.message);
  }
  async block(userId: string) { const { error } = await this.sb.from('blocks').insert({ blocked: userId }); if (error && error.code !== '23505') throw new Error(error.message); }
  async blocked(): Promise<Set<string>> { const { data } = await this.sb.from('blocks').select('blocked'); return new Set((data ?? []).map(r => r.blocked as string)); }
}
