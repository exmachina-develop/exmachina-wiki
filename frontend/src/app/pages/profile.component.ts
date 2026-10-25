import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Toasts } from '../core/toast.service';
import { AvatarComponent } from '../shared/ui';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [FormsModule, AvatarComponent],
  template: `
    <div class="page narrow">
      <header class="page-head"><div><span class="eyebrow">Cuenta</span><h1 class="title-xl">Mi perfil.</h1></div>
        <x-avatar size="lg" [name]="auth.user()?.name ?? ''" [color]="auth.user()?.color ?? ''" /></header>

      <section class="card box">
        <span class="eyebrow">Datos</span>
        <div class="field"><label for="pn">Nombre</label><input id="pn" class="input" [(ngModel)]="name" maxlength="120"></div>
        <div class="field"><label for="pj">Cargo</label><input id="pj" class="input" [(ngModel)]="jobTitle" maxlength="120" placeholder="Ej. CTO"></div>
        <div class="field"><label>Correo</label><input class="input" [value]="auth.user()?.email" disabled></div>
        <div class="field"><label>Rol</label><input class="input" [value]="auth.user()?.role?.name" disabled></div>
        <button class="btn" (click)="saveProfile()" [disabled]="name.trim().length < 2">Guardar cambios</button>
      </section>

      <section class="card box">
        <span class="eyebrow">Cambiar contraseña</span>
        <div class="field"><label for="p1">Contraseña actual</label><input id="p1" class="input" type="password" autocomplete="current-password" [(ngModel)]="current"></div>
        <div class="field"><label for="p2">Nueva contraseña (mín. 8 caracteres)</label><input id="p2" class="input" type="password" autocomplete="new-password" [(ngModel)]="next"></div>
        <button class="btn" (click)="changePw()" [disabled]="!current || next.length < 8">Actualizar contraseña</button>
      </section>
    </div>`,
  styles: [`.narrow { max-width: 720px; } .box { padding: 32px; margin-bottom: 20px; .eyebrow { display: block; margin-bottom: 24px; } }`],
})
export class ProfileComponent {
  private api = inject(Api);
  private toasts = inject(Toasts);
  auth = inject(Auth);
  name = this.auth.user()?.name ?? '';
  jobTitle = this.auth.user()?.jobTitle ?? '';
  current = '';
  next = '';
  busy = signal(false);

  async saveProfile() {
    try { this.auth.user.set(await this.api.updateProfile({ name: this.name.trim(), jobTitle: this.jobTitle })); this.toasts.ok('Perfil actualizado'); } catch (e) { this.toasts.error(e); }
  }
  async changePw() {
    try { await this.api.changePassword(this.current, this.next); this.current = this.next = ''; this.toasts.ok('Contraseña actualizada'); } catch (e) { this.toasts.error(e); }
  }
}
