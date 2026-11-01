export type ThemeMode = 'light' | 'dark' | 'system';

export function applyTheme(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
