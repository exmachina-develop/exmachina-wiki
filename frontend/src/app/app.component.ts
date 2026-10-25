import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toasts } from './core/toast.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    <div class="toasts" aria-live="polite">
      @for (t of toasts.items(); track t.id) {
        <div class="toast" [class.error]="t.kind === 'error'" [class.ok]="t.kind === 'ok'">{{ t.text }}</div>
      }
    </div>`,
  styles: [`
    .toasts { position: fixed; right: 20px; bottom: 20px; z-index: 300; display: flex; flex-direction: column; gap: 8px; max-width: calc(100vw - 40px); }
    .toast { background: var(--surface-3); border: 1px solid var(--line-strong); border-left: 2px solid var(--violet); padding: 12px 16px; font-size: 14px; border-radius: 2px; animation: in .35s var(--ease); max-width: 420px; }
    .toast.error { border-left-color: var(--danger); } .toast.ok { border-left-color: var(--ok); }
    @keyframes in { from { opacity: 0; transform: translateY(10px); } }
    @media (max-width: 700px) { .toasts { left: 20px; bottom: calc(76px + env(safe-area-inset-bottom)); } }
  `],
})
export class AppComponent {
  toasts = inject(Toasts);
}
