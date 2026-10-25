import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const KEY = 'exm_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  mode = signal<Theme>(this.read());

  constructor() {
    effect(() => {
      const m = this.mode();
      document.documentElement.setAttribute('data-theme', m);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', m === 'dark' ? '#050509' : '#ffffff');
      try { localStorage.setItem(KEY, m); } catch { /* storage unavailable */ }
    });
  }

  toggle() { this.mode.update((m) => (m === 'dark' ? 'light' : 'dark')); }

  private read(): Theme {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  }
}
