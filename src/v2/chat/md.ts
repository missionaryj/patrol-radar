// Tiny markdown → HTML for the bundled terms (trusted, static input): headings, bullets, bold, paragraphs.
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
export function miniMd(src: string): string {
  const out: string[] = []; let list = false;
  for (const line of src.split('\n')) {
    const l = line.trim();
    if (l.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (!l) continue;
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    out.push(h ? `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>` : `<p>${inline(l)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
