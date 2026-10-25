import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { DirUser, PermissionDef, Role } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AvatarComponent, IconComponent, ModalComponent, relTime } from '../shared/ui';

interface UserForm { id?: string; name: string; email: string; password: string; roleId: string; jobTitle: string; active: boolean }
interface RoleForm { id?: string; name: string; description: string; permissions: string[]; isSystem?: boolean }

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, AvatarComponent, IconComponent, ModalComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Administración</span><h1 class="title-xl">Usuarios y permisos.</h1></div>
        <div class="tabs" role="tablist">
          @if (auth.can('users.manage')) { <button role="tab" [class.on]="tab() === 'users'" (click)="tab.set('users')">Usuarios</button> }
          @if (auth.can('roles.manage')) { <button role="tab" [class.on]="tab() === 'roles'" (click)="tab.set('roles')">Roles</button> }
        </div>
      </header>

      @if (tab() === 'users') {
        <div class="bar"><span class="muted">{{ users().length }} usuarios</span><button class="btn" (click)="newUser()"><x-icon name="plus" /> Nuevo usuario</button></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td><div class="who"><x-avatar [name]="u.name" [color]="u.color" /><span><b>{{ u.name }}</b><small>{{ u.email }}</small></span></div></td>
                  <td><span class="chip violet">{{ u.role?.name }}</span></td>
                  <td>{{ u.active ? 'Activo' : 'Desactivado' }}</td>
                  <td class="muted">{{ u.lastLoginAt ? rel(u.lastLoginAt) : 'Nunca' }}</td>
                  <td class="act"><button class="btn subtle icon sm" (click)="editUser(u)" aria-label="Editar"><x-icon name="edit" /></button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="bar"><span class="muted">{{ roles().length }} roles</span><button class="btn" (click)="newRole()"><x-icon name="plus" /> Nuevo rol</button></div>
        <div class="grid">
          @for (r of roles(); track r.id) {
            <button class="card hover role" (click)="editRole(r)">
              <div class="top"><h3>{{ r.name }}</h3>@if (r.isSystem) { <span class="chip">Sistema</span> }</div>
              <p class="muted">{{ r.description || 'Sin descripción' }}</p>
              <footer><span class="eyebrow">{{ r.permissions.length }} permisos</span><span class="eyebrow">{{ r.users }} usuarios</span></footer>
            </button>
          }
        </div>
      }
    </div>

    @if (uf(); as f) {
      <x-modal (closed)="uf.set(null)">
        <h2>{{ f.id ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
        <div class="field"><label for="un">Nombre completo</label><input id="un" class="input" [(ngModel)]="f.name" maxlength="120"></div>
        <div class="field"><label for="ue">Correo</label><input id="ue" class="input" type="email" [(ngModel)]="f.email"></div>
        <div class="field"><label for="uj">Cargo</label><input id="uj" class="input" [(ngModel)]="f.jobTitle" maxlength="120"></div>
        <div class="field"><label for="ur">Rol</label><select id="ur" class="select" [(ngModel)]="f.roleId">@for (r of roles(); track r.id) { <option [value]="r.id">{{ r.name }}</option> }</select></div>
        <div class="field"><label for="up">{{ f.id ? 'Nueva contraseña (opcional)' : 'Contraseña (mín. 8 caracteres)' }}</label><input id="up" class="input" type="password" autocomplete="new-password" [(ngModel)]="f.password"></div>
        @if (f.id) { <label class="check"><input type="checkbox" [(ngModel)]="f.active"> Cuenta activa</label> }
        <div class="modal-actions">
          @if (f.id && f.id !== auth.user()?.id) { <button class="btn danger" style="margin-right:auto" (click)="deleteUser(f)">Eliminar</button> }
          <button class="btn ghost" (click)="uf.set(null)">Cancelar</button>
          <button class="btn" (click)="saveUser()" [disabled]="busy() || f.name.trim().length < 2 || !f.email || !f.roleId || (!f.id && f.password.length < 8)">Guardar</button>
        </div>
      </x-modal>
    }

    @if (rf(); as f) {
      <x-modal [wide]="true" (closed)="rf.set(null)">
        <h2>{{ f.id ? 'Editar rol' : 'Nuevo rol' }}</h2>
        <div class="two">
          <div class="field"><label for="rn">Nombre</label><input id="rn" class="input" [(ngModel)]="f.name" maxlength="60"></div>
          <div class="field"><label for="rd">Descripción</label><input id="rd" class="input" [(ngModel)]="f.description" maxlength="200"></div>
        </div>
        <div class="perms">
          @for (g of groups(); track g.name) {
            <div class="pg"><span class="eyebrow">{{ g.name }}</span>
              @for (p of g.items; track p.key) {
                <label class="check"><input type="checkbox" [checked]="f.permissions.includes(p.key)" (change)="toggle(f, p.key)" [disabled]="f.isSystem && f.name === 'Administrador'"> {{ p.label }}</label>
              }
            </div>
          }
        </div>
        @if (f.isSystem && f.name === 'Administrador') { <p class="muted" style="font-size:13px;margin-top:16px">El rol Administrador siempre conserva todos los permisos.</p> }
        <div class="modal-actions">
          @if (f.id && !f.isSystem) { <button class="btn danger" style="margin-right:auto" (click)="deleteRole(f)">Eliminar</button> }
          <button class="btn ghost" (click)="rf.set(null)">Cancelar</button>
          <button class="btn" (click)="saveRole()" [disabled]="busy() || f.name.trim().length < 2 || (f.isSystem && f.name === 'Administrador')">Guardar</button>
        </div>
      </x-modal>
    }`,
  styles: [`
    .tabs { display: flex; gap: 4px; border: 1px solid var(--line); padding: 3px; border-radius: 2px; button { height: 32px; padding: 0 18px; font-size: 14px; color: var(--muted); border-radius: 2px; &.on { background: var(--white); color: var(--black); } } }
    .bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .who { display: flex; align-items: center; gap: 12px; span { display: flex; flex-direction: column; line-height: 1.3; } b { font-weight: 400; } small { color: var(--gray-light); font-size: 12px; } } .act { text-align: right; }
    .role { text-align: left; padding: 24px; display: flex; flex-direction: column; gap: 12px; min-height: 170px; } .top { display: flex; justify-content: space-between; align-items: center; gap: 10px; } h3 { font-size: 22px; letter-spacing: -.02em; } p { font-size: 14px; flex: 1; }
    footer { display: flex; justify-content: space-between; padding-top: 14px; border-top: 1px solid var(--line); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .perms { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; margin-top: 8px; } .pg { display: flex; flex-direction: column; gap: 12px; }
    @media (max-width: 640px) { .two { grid-template-columns: 1fr; } }
  `],
})
export class AdminComponent implements OnInit {
  private api = inject(Api);
  private toasts = inject(Toasts);
  auth = inject(Auth);
  tab = signal<'users' | 'roles'>(this.auth.can('users.manage') ? 'users' : 'roles');
  users = signal<DirUser[]>([]);
  roles = signal<Role[]>([]);
  catalog = signal<PermissionDef[]>([]);
  uf = signal<UserForm | null>(null);
  rf = signal<RoleForm | null>(null);
  busy = signal(false);
  rel = relTime;
  groups = computed(() => {
    const m = new Map<string, PermissionDef[]>();
    for (const p of this.catalog()) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m].map(([name, items]) => ({ name, items }));
  });

  async ngOnInit() { await this.reload(); }
  async reload() {
    try {
      const [u, r, c] = await Promise.all([this.api.users(), this.api.roles(), this.api.permissionCatalog()]);
      this.users.set(u); this.roles.set(r); this.catalog.set(c);
    } catch (e) { this.toasts.error(e); }
  }

  newUser() { this.uf.set({ name: '', email: '', password: '', roleId: this.roles().find((r) => r.name === 'Editor')?.id ?? this.roles()[0]?.id ?? '', jobTitle: '', active: true }); }
  editUser(u: DirUser) { this.uf.set({ id: u.id, name: u.name, email: u.email, password: '', roleId: u.role?.id ?? '', jobTitle: u.jobTitle, active: u.active }); }
  async saveUser() {
    const f = this.uf()!;
    this.busy.set(true);
    try {
      if (f.id) await this.api.updateUser(f.id, { name: f.name, email: f.email, roleId: f.roleId, jobTitle: f.jobTitle, active: f.active, ...(f.password ? { password: f.password } : {}) });
      else await this.api.createUser({ name: f.name, email: f.email, password: f.password, roleId: f.roleId, jobTitle: f.jobTitle });
      this.uf.set(null); this.toasts.ok('Usuario guardado'); await this.reload();
    } catch (e) { this.toasts.error(e); } finally { this.busy.set(false); }
  }
  async deleteUser(f: UserForm) {
    if (!f.id || !confirm(`¿Eliminar a ${f.name}? Sus documentos se conservan.`)) return;
    try { await this.api.deleteUser(f.id); this.uf.set(null); this.toasts.ok('Usuario eliminado'); await this.reload(); } catch (e) { this.toasts.error(e); }
  }

  newRole() { this.rf.set({ name: '', description: '', permissions: ['documents.export'] }); }
  editRole(r: Role) { this.rf.set({ id: r.id, name: r.name, description: r.description, permissions: [...r.permissions], isSystem: r.isSystem }); }
  toggle(f: RoleForm, key: string) { f.permissions = f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key]; }
  async saveRole() {
    const f = this.rf()!;
    this.busy.set(true);
    try {
      await this.api.saveRole(f.id ?? null, { name: f.name, description: f.description, permissions: f.permissions });
      this.rf.set(null); this.toasts.ok('Rol guardado'); await this.reload();
    } catch (e) { this.toasts.error(e); } finally { this.busy.set(false); }
  }
  async deleteRole(f: RoleForm) {
    if (!f.id || !confirm(`¿Eliminar el rol «${f.name}»?`)) return;
    try { await this.api.deleteRole(f.id); this.rf.set(null); this.toasts.ok('Rol eliminado'); await this.reload(); } catch (e) { this.toasts.error(e); }
  }
}
