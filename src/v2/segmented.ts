// Turns <select data-seg> into a segmented control. The <select> stays the source of
// truth (kept in the DOM, visually hidden), so all existing .value/.onchange logic is unchanged.
export function mountSegmented(sel: HTMLSelectElement): void {
  const labels = (sel.dataset.labels ?? '').split('|');
  const wrap = document.createElement('div'); wrap.className = 'seg'; wrap.setAttribute('role', 'radiogroup');
  const btns = Array.from(sel.options).map((o, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = labels[i] || o.text; b.title = o.text;
    b.setAttribute('role', 'radio');
    b.onclick = () => { if (sel.value === o.value) return; sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); sync(); };
    wrap.appendChild(b); return b;
  });
  const sync = () => btns.forEach((b, i) => { const on = sel.selectedIndex === i; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  sel.classList.add('seg-src'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.after(wrap); sel.addEventListener('change', sync);
  // programmatic .value writes don't fire events: poll cheaply
  setInterval(sync, 1000); sync();
}
