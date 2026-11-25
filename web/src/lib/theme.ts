import { useCallback, useSyncExternalStore } from 'react';

/**
 * Light / dark / system, stored exactly as the UOS shell stores it
 * ('uos-theme' in localStorage, light when nothing is stored). public/theme-init.js
 * applies the stored choice before first paint; this keeps it in step afterwards.
 * Accounts runs on its own origin, so its choice is kept separately from the shell's.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'uos-theme';
const DEFAULT: ThemeChoice = 'light';
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' || v === 'light' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current: ThemeChoice = typeof window === 'undefined' ? DEFAULT : read();

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement) {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice) {
  current = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable: still applies for this page */
  }
  applyTheme(choice);
  listeners.forEach((fn) => fn());
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => DEFAULT,
  );
  return [theme, useCallback((t: ThemeChoice) => setTheme(t), [])];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A university's own accent colour, applied the way the shell applies its
 * org accent_color: --accent, --accent-block and a 14% tint. Invalid or empty
 * values leave the shell's default accent.
 */
export function applyOrgAccent(color: string | null | undefined, root: HTMLElement = document.documentElement) {
  if (color && HEX.test(color)) {
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-block', color);
    root.style.setProperty('--accent-tint', `color-mix(in srgb, ${color} 14%, transparent)`);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-block');
    root.style.removeProperty('--accent-tint');
  }
}
