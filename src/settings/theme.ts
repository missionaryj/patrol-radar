/** Appearance: Light, Dark, or Match system. Only the choice is stored on this device. */
export const THEME_KEY = 'pr.theme';
export const THEME_COLOR = { light: '#f4f6f8', dark: '#07080a' } as const;
export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export function readThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** Match system follows the phone. Light and Dark stay put when the phone changes. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}

export interface ThemeRoot {
  dataset: { theme?: string };
  style: { colorScheme: string; background: string };
}
export interface ThemeDoc {
  documentElement: ThemeRoot;
  querySelector: (sel: string) => { setAttribute: (name: string, value: string) => void } | null;
}

/** Paint the resolved theme before the next frame. Safe to call again with the same value. */
export function applyResolved(theme: ResolvedTheme, doc: ThemeDoc = document) {
  const root = doc.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.background = THEME_COLOR[theme];
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export interface ThemeEnv {
  store: Pick<Storage, 'getItem' | 'setItem'>;
  systemDark: () => boolean;
  listen: (fn: () => void) => void;
  doc: ThemeDoc;
  win: { __prThemeSync?: (night: boolean) => void };
  native?: (choice: ThemeChoice, resolved: ResolvedTheme) => void;
}

function browserNative(choice: ThemeChoice, resolved: ResolvedTheme) {
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.() || cap.getPlatform?.() !== 'android') return;
  void cap.Plugins?.PatrolScan?.setThemeBars?.({ choice, resolved })?.catch?.(() => {});
}

function browserEnv(): ThemeEnv {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  return {
    store: localStorage, systemDark: () => mq.matches, listen: fn => mq.addEventListener('change', fn),
    doc: document, win: window as ThemeEnv['win'], native: browserNative,
  };
}

/** Apply the saved choice, then keep Match system in step with the phone. */
export function mountTheme(onResolved: (theme: ResolvedTheme) => void, env: ThemeEnv = browserEnv()) {
  let choice = readThemeChoice(env.store.getItem(THEME_KEY));
  let systemDark = env.systemDark();
  const publish = (tellNative: boolean) => {
    const theme = resolveTheme(choice, systemDark);
    applyResolved(theme, env.doc);
    onResolved(theme);
    if (tellNative) env.native?.(choice, theme);
  };
  const followSystem = () => { if (choice === 'system') publish(true); };
  env.listen(() => {
    // The Android activity reports system theme changes itself. The WebView query can stay stale.
    const cap = (globalThis as any).Capacitor;
    if (cap?.isNativePlatform?.()) return;
    systemDark = env.systemDark();
    followSystem();
  });
  // Android delivers uiMode here when the WebView media query does not update on its own.
  // The activity already painted the bars before this call, so don't echo them back.
  env.win.__prThemeSync = (night: boolean) => { systemDark = !!night; if (choice === 'system') publish(false); };
  publish(true);
  return {
    choice: () => choice,
    set(next: ThemeChoice) {
      choice = readThemeChoice(next);
      try { env.store.setItem(THEME_KEY, choice); } catch { /* private mode */ }
      publish(true);
    },
  };
}
