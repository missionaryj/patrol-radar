import { Capacitor } from '@capacitor/core';

export const sessionFileName = (d = new Date()) => `patrol-radar-session-${d.toISOString().replace(/[:.]/g, '-')}.json`;
export const isNativeShare = () => Capacitor.isNativePlatform();

/** Android app: write to cache and open the system share sheet (Gmail, Drive, etc.) in one step. Web: download. */
export async function exportSession(json: string, name = sessionFileName()): Promise<'shared' | 'downloaded'> {
  if (isNativeShare()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const { uri } = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    try {
      await Share.share({ title: 'Patrol Radar session', text: 'Patrol Radar debug session (send to percolatorbiz@gmail.com)', files: [uri], dialogTitle: 'Share session file' });
    } catch (e: any) { if (!/cancel/i.test(String(e?.message ?? e))) throw e; }
    return 'shared';
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}
