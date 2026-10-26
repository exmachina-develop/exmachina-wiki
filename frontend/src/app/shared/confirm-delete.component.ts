import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from './ui';

/** Destructive-action dialog: the button only unlocks after typing the confirmation word. */
@Component({
  selector: 'app-confirm-delete',
  standalone: true,
  imports: [FormsModule, ModalComponent],
  template: `
    <x-modal (closed)="cancelled.emit()">
      <h2>{{ title }}</h2>
      <p class="muted msg">{{ message }}</p>
      <div class="field">
        <label for="cd">Para confirmar, escribe <b class="word">{{ word }}</b></label>
        <input id="cd" class="input" [(ngModel)]="typed" autocomplete="off" autocapitalize="none" spellcheck="false" [placeholder]="word" (keyup.enter)="ok()" autofocus>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" (click)="cancelled.emit()" [disabled]="busy">Cancelar</button>
        <button class="btn danger solid" [disabled]="!matches || busy" (click)="ok()">
          @if (busy) { <span class="spinner"></span> } @else { {{ action }} }
        </button>
      </div>
    </x-modal>`,
  styles: [`
    .msg { font-size: 14px; margin: -8px 0 22px; line-height: 1.5; } .word { color: var(--danger); font-weight: 600; letter-spacing: .02em; }
    .btn.danger.solid:not(:disabled) { background: var(--danger); color: #fff; border-color: var(--danger); &:hover { opacity: .88; } }
  `],
})
export class ConfirmDeleteComponent {
  @Input() title = '¿Eliminar?';
  @Input() message = 'Esta acción no se puede deshacer.';
  @Input() action = 'Eliminar';
  @Input() word = 'eliminar';
  @Input() busy = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  typed = '';
  get matches() { return this.typed.trim().toLowerCase() === this.word.toLowerCase(); }
  ok() { if (this.matches && !this.busy) this.confirmed.emit(); }
}
