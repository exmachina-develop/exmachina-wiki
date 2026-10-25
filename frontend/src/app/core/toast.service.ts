import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; text: string; kind: 'ok' | 'error' | 'info' }

@Injectable({ providedIn: 'root' })
export class Toasts {
  items = signal<Toast[]>([]);
  private n = 0;

  show(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
    const id = ++this.n;
    this.items.update((l) => [...l, { id, text, kind }]);
    setTimeout(() => this.items.update((l) => l.filter((t) => t.id !== id)), ms);
  }
  ok = (t: string) => this.show(t, 'ok');
  error(e: unknown, fallback = 'Ocurrió un error') {
    const msg = (e as any)?.error?.message;
    this.show(Array.isArray(msg) ? msg.join(' · ') : msg || fallback, 'error', 6000);
  }
}
