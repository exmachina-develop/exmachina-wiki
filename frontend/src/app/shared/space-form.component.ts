import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Space } from '../core/models';
import { Toasts } from '../core/toast.service';
import { ModalComponent } from './ui';

const ICONS = ['◆', '●', '■', '▲', '✦', '❖', '☰', '⚑', '⚙', '✎', '☼', '♦'];

/** Create or edit a workspace (name, description, icon, visibility). */
@Component({
  selector: 'app-space-form',
  standalone: true,
  imports: [FormsModule, ModalComponent],
  template: `
    <x-modal (closed)="closed.emit()">
      <h2>{{ space ? 'Ajustes del espacio' : 'Nuevo espacio de trabajo' }}</h2>
      <div class="field"><label for="sn">Nombre</label><input id="sn" class="input" [(ngModel)]="name" maxlength="80" placeholder="Ej. Ingeniería" autofocus></div>
      <div class="field"><label for="sd">Descripción</label><textarea id="sd" class="textarea" [(ngModel)]="description" maxlength="400" placeholder="¿Para qué sirve este espacio?"></textarea></div>
      <div class="field">
        <label>Icono</label>
        <div class="icons">@for (i of icons; track i) { <button type="button" class="ic" [class.on]="icon === i" (click)="icon = i">{{ i }}</button> }</div>
      </div>
      @if (!space) {
        <div class="field"><label for="sk">Clave (opcional)</label><input id="sk" class="input" [(ngModel)]="key" maxlength="12" placeholder="ING" style="text-transform:uppercase"></div>
      }
      <div class="field">
        <label for="sv">Visibilidad</label>
        <select id="sv" class="select" [(ngModel)]="visibility">
          <option value="company">Toda la empresa puede ver este espacio</option>
          <option value="private">Privado: solo sus miembros</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" (click)="closed.emit()">Cancelar</button>
        <button class="btn" [disabled]="busy() || name.trim().length < 2" (click)="save()">{{ space ? 'Guardar' : 'Crear espacio' }}</button>
      </div>
    </x-modal>`,
  styles: [`.icons { display: flex; gap: 6px; flex-wrap: wrap; } .ic { width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 2px; font-size: 16px; color: var(--muted); &:hover { border-color: var(--line-strong); color: var(--white); } &.on { border-color: var(--violet); color: var(--white); background: rgba(112,71,255,.15); } }`],
})
export class SpaceFormComponent {
  private api = inject(Api);
  private toasts = inject(Toasts);
  icons = ICONS;
  name = '';
  description = '';
  icon = '◆';
  key = '';
  visibility: 'company' | 'private' = 'company';
  busy = signal(false);
  private _space?: Space;
  @Input() set space(s: Space | undefined) {
    this._space = s;
    if (s) { this.name = s.name; this.description = s.description; this.icon = s.icon; this.visibility = s.visibility; }
  }
  get space() { return this._space; }
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Space>();

  async save() {
    this.busy.set(true);
    try {
      const body = { name: this.name.trim(), description: this.description, icon: this.icon, visibility: this.visibility };
      const s = this.space ? await this.api.updateSpace(this.space.id, body) : await this.api.createSpace({ ...body, ...(this.key.trim() ? { key: this.key.trim() } : {}) });
      this.toasts.ok(this.space ? 'Espacio actualizado' : 'Espacio creado');
      this.saved.emit(s);
    } catch (e) {
      this.toasts.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
