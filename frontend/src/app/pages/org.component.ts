import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Department, DirUser, OrgMember } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AvatarComponent, IconComponent, ModalComponent } from '../shared/ui';

export interface OrgTreeNode { dept: Department; children: OrgTreeNode[] }

/** Recursive branch of the org chart (CSS connector lines on desktop, indented list on mobile). */
@Component({
  selector: 'org-node',
  standalone: true,
  imports: [AvatarComponent, IconComponent],
  template: `
    <div class="box" [style.--c]="node.dept.color" [class.sel]="selected === node.dept.id">
      <button class="card hover body" (click)="pick.emit(node.dept)">
        <span class="eyebrow">{{ node.children.length ? 'Área' : 'Equipo' }}</span>
        <h3>{{ node.dept.name }}</h3>
        @if (node.dept.description) { <p class="muted">{{ node.dept.description }}</p> }
        <div class="people">
          @for (m of heads(); track m.userId) {
            <div class="head"><x-avatar size="sm" [name]="m.name" [color]="m.color" /><span><b>{{ m.name }}</b><small>{{ m.title || 'Responsable' }}</small></span></div>
          }
          @if (rest().length) {
            <div class="stack">@for (m of rest().slice(0, 5); track m.userId) { <x-avatar size="sm" [name]="m.name" [color]="m.color" /> }
              @if (rest().length > 5) { <span class="more">+{{ rest().length - 5 }}</span> }</div>
          }
          @if (!node.dept.members.length) { <small class="muted">Sin personas asignadas</small> }
        </div>
      </button>
      @if (canManage) { <button class="btn subtle icon sm add" (click)="add.emit(node.dept)" title="Añadir área dependiente" aria-label="Añadir área dependiente"><x-icon name="plus" /></button> }
    </div>
    @if (node.children.length) {
      <ul>
        @for (c of node.children; track c.dept.id) {
          <li><org-node [node]="c" [canManage]="canManage" [selected]="selected" (pick)="pick.emit($event)" (add)="add.emit($event)" /></li>
        }
      </ul>
    }`,
  styles: [`
    :host { display: flex; flex-direction: column; align-items: center; }
    .box { position: relative; display: block; width: 194px; }
    .body { width: 100%; text-align: left; padding: 16px 14px 14px; border-top: 2px solid var(--c); display: flex; flex-direction: column; gap: 8px; }
    .box.sel .body { border-color: var(--line-strong); border-top-color: var(--c); background: var(--surface-2); }
    h3 { font-size: 18px; letter-spacing: -.015em; } p { font-size: 13px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .people { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--line); }
    .head { display: flex; align-items: center; gap: 10px; span { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; } b { font-weight: 400; font-size: 13px; } small { color: var(--gray-light); font-size: 11px; } }
    .stack { display: flex; align-items: center; .avatar { margin-left: -6px; box-shadow: 0 0 0 2px var(--surface); &:first-child { margin-left: 0; } } .more { font-size: 11px; color: var(--muted); margin-left: 8px; } }
    .add { position: absolute; right: 6px; top: 8px; opacity: 0; transition: opacity .2s; } .box:hover .add, .add:focus-visible { opacity: 1; }
    @media (hover: none) { .add { opacity: .8; } }
    ul { list-style: none; display: flex; justify-content: center; padding: 28px 0 0; position: relative; margin: 0; }
    ul::before { content: ''; position: absolute; top: 0; left: 50%; border-left: 1px solid var(--line-strong); height: 28px; }
    li { position: relative; padding: 28px 5px 0; display: flex; justify-content: center; }
    li::before, li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 28px; border-top: 1px solid var(--line-strong); }
    li::after { right: auto; left: 50%; border-left: 1px solid var(--line-strong); }
    li:only-child::before, li:only-child::after { display: none; } li:only-child { padding-top: 0; }
    li:first-child::before, li:last-child::after { border: 0 none; } li:last-child::before { border-right: 1px solid var(--line-strong); border-radius: 0 4px 0 0; } li:first-child::after { border-radius: 4px 0 0 0; }
    @media (max-width: 900px) {
      .box { width: 100%; max-width: 360px; }
      ul { display: block; padding: 12px 0 0 18px; margin-left: 10px; border-left: 1px solid var(--line-strong); } ul::before { display: none; }
      :host { align-items: flex-start; } li { display: block; padding: 12px 0 0 14px; text-align: left; } li::before { right: auto; left: -18px; width: 14px; height: 36px; border: 0; border-bottom: 1px solid var(--line-strong); border-radius: 0; top: 0; display: block !important; } li::after { display: none !important; }
      li:only-child { padding-top: 12px; }
    }
  `],
})
export class OrgNodeComponent {
  @Input({ required: true }) node!: OrgTreeNode;
  @Input() canManage = false;
  @Input() selected: string | null = null;
  @Output() pick = new EventEmitter<Department>();
  @Output() add = new EventEmitter<Department>();
  heads = () => this.node.dept.members.filter((m) => m.isHead);
  rest = () => this.node.dept.members.filter((m) => !m.isHead);
}

@Component({
  selector: 'app-org',
  standalone: true,
  imports: [FormsModule, OrgNodeComponent, IconComponent, AvatarComponent, ModalComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Estructura</span><h1 class="title-xl">Organigrama.</h1><p class="muted sub">Áreas de la empresa y sus responsables.</p></div>
        @if (auth.can('org.manage')) { <button class="btn" (click)="openNew(null)"><x-icon name="plus" /> Nueva área</button> }
      </header>

      @if (loading()) { <div class="empty"><span class="spinner"></span></div> }
      @else if (!roots().length) { <div class="empty">Aún no hay áreas definidas.@if (auth.can('org.manage')) { <br>Crea la primera para empezar a dibujar el organigrama. }</div> }
      @else {
        <div class="chart"><div class="trees">
          @for (r of roots(); track r.dept.id) { <org-node [node]="r" [canManage]="auth.can('org.manage')" (pick)="open($event)" (add)="openNew($event.id)" /> }
        </div></div>
      }
    </div>

    @if (dlg(); as d) {
      <x-modal [wide]="true" (closed)="dlg.set(null)">
        <h2>{{ d.id ? (canEdit() ? 'Editar área' : d.name) : 'Nueva área' }}</h2>
        @if (canEdit()) {
          <div class="two">
            <div class="field"><label for="dn">Nombre</label><input id="dn" class="input" [(ngModel)]="d.name" maxlength="100" placeholder="Ej. Ingeniería"></div>
            <div class="field"><label for="dp">Depende de</label>
              <select id="dp" class="select" [(ngModel)]="d.parentId">
                <option [ngValue]="null">— Nivel superior —</option>
                @for (o of parentOptions(); track o.id) { <option [ngValue]="o.id">{{ o.name }}</option> }
              </select></div>
          </div>
          <div class="field"><label for="dd">Descripción</label><textarea id="dd" class="textarea" [(ngModel)]="d.description" maxlength="400"></textarea></div>
          <div class="field"><label>Color</label><div class="colors">@for (c of colors; track c) { <button type="button" class="dot" [style.background]="c" [class.on]="d.color === c" (click)="d.color = c" [attr.aria-label]="c"></button> }</div></div>

          <div class="field">
            <label>Personas y responsables</label>
            <div class="mlist">
              @for (m of members(); track m.userId) {
                <div class="mrow">
                  <x-avatar size="sm" [name]="m.name" [color]="m.color" />
                  <span class="mn"><b>{{ m.name }}</b></span>
                  <input class="input t" [(ngModel)]="m.title" placeholder="Cargo (opcional)" maxlength="100" [attr.aria-label]="'Cargo de ' + m.name">
                  <label class="check"><input type="checkbox" [(ngModel)]="m.isHead"> Responsable</label>
                  <button class="btn subtle icon sm" (click)="removeMember(m.userId)" aria-label="Quitar"><x-icon name="close" /></button>
                </div>
              }
              @if (!members().length) { <small class="muted">Nadie asignado todavía.</small> }
            </div>
            <select class="select" style="margin-top:10px" (change)="addMember($any($event.target).value); $any($event.target).value = ''" aria-label="Añadir persona">
              <option value="">Añadir persona…</option>
              @for (u of candidates(); track u.id) { <option [value]="u.id">{{ u.name }}{{ u.jobTitle ? ' · ' + u.jobTitle : '' }}</option> }
            </select>
          </div>
          <div class="modal-actions">
            @if (d.id) { <button class="btn danger" style="margin-right:auto" (click)="remove()">Eliminar área</button> }
            <button class="btn ghost" (click)="dlg.set(null)">Cancelar</button>
            <button class="btn" [disabled]="d.name.trim().length < 2 || busy()" (click)="save()">Guardar</button>
          </div>
        } @else {
          <p class="muted">{{ d.description }}</p>
          <div class="mlist">@for (m of members(); track m.userId) { <div class="mrow ro"><x-avatar size="sm" [name]="m.name" [color]="m.color" /><span class="mn"><b>{{ m.name }}</b><small>{{ m.title || m.jobTitle }}</small></span>@if (m.isHead) { <span class="chip violet">Responsable</span> }</div> }</div>
          <div class="modal-actions"><button class="btn ghost" (click)="dlg.set(null)">Cerrar</button></div>
        }
      </x-modal>
    }`,
  styles: [`
    .sub { margin-top: 14px; } .chart { overflow-x: auto; padding: 8px 0 40px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); background-image: radial-gradient(rgba(244,244,247,.05) 1px, transparent 1px); background-size: 22px 22px; }
    .trees { display: flex; gap: 40px; justify-content: safe center; padding: 40px 32px; min-width: min-content; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .colors { display: flex; gap: 8px; } .dot { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; &.on { border-color: var(--white); } }
    .mlist { display: flex; flex-direction: column; gap: 8px; } .mrow { display: grid; grid-template-columns: 24px minmax(90px, 1fr) minmax(120px, 1.2fr) auto 30px; gap: 12px; align-items: center; } .mrow.ro { grid-template-columns: 24px 1fr auto; }
    .mn { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; b { font-weight: 400; font-size: 14px; } small { color: var(--gray-light); font-size: 12px; } } .mrow .t { height: 34px; font-size: 13px; }
    @media (max-width: 900px) { .chart { padding: 8px 0 24px; } .trees { padding: 24px 16px; flex-direction: column; gap: 24px; } }
    @media (max-width: 640px) { .two { grid-template-columns: 1fr; } .mrow { grid-template-columns: 24px 1fr 30px; } .mrow .t, .mrow .check { grid-column: 2 / 4; } }
  `],
})
export class OrgComponent implements OnInit {
  private api = inject(Api);
  private toasts = inject(Toasts);
  auth = inject(Auth);
  depts = signal<Department[]>([]);
  users = signal<DirUser[]>([]);
  loading = signal(true);
  busy = signal(false);
  dlg = signal<{ id?: string; name: string; description: string; color: string; parentId: string | null } | null>(null);
  members = signal<(OrgMember & { jobTitle: string })[]>([]);
  colors = ['#7047FF', '#416BFF', '#2BB3A3', '#E0A84A', '#E0587A', '#8B8FA3'];
  canEdit = computed(() => this.auth.can('org.manage'));

  roots = computed<OrgTreeNode[]>(() => {
    const all = this.depts();
    const ids = new Set(all.map((d) => d.id));
    const build = (p: string | null): OrgTreeNode[] =>
      all.filter((d) => (d.parentId && ids.has(d.parentId) ? d.parentId : null) === p).map((dept) => ({ dept, children: build(dept.id) }));
    return build(null);
  });
  candidates = computed(() => this.users().filter((u) => u.active && !this.members().some((m) => m.userId === u.id)));
  parentOptions = computed(() => {
    const id = this.dlg()?.id;
    if (!id) return this.depts();
    const banned = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const d of this.depts()) if (d.parentId && banned.has(d.parentId) && !banned.has(d.id)) { banned.add(d.id); grew = true; } }
    return this.depts().filter((d) => !banned.has(d.id));
  });

  async ngOnInit() {
    try {
      const [d, u] = await Promise.all([this.api.org(), this.api.users()]);
      this.depts.set(d); this.users.set(u);
    } catch (e) { this.toasts.error(e); } finally { this.loading.set(false); }
  }

  open(d: Department) {
    this.dlg.set({ id: d.id, name: d.name, description: d.description, color: d.color, parentId: d.parentId });
    this.members.set(d.members.map((m) => ({ ...m })));
  }
  openNew(parentId: string | null) {
    this.dlg.set({ name: '', description: '', color: '#416BFF', parentId });
    this.members.set([]);
  }
  addMember(id: string) {
    const u = this.users().find((x) => x.id === id);
    if (u) this.members.update((l) => [...l, { userId: u.id, name: u.name, email: u.email, color: u.color, jobTitle: u.jobTitle, isHead: false, title: '' }]);
  }
  removeMember(id: string) { this.members.update((l) => l.filter((m) => m.userId !== id)); }

  async save() {
    const d = this.dlg()!;
    this.busy.set(true);
    try {
      const body = { name: d.name.trim(), description: d.description, color: d.color, parentId: d.parentId };
      const dept = d.id ? await this.api.updateDept(d.id, body) : await this.api.createDept(body);
      this.depts.set(await this.api.setDeptMembers(dept.id, this.members().map((m) => ({ userId: m.userId, isHead: m.isHead, title: m.title }))));
      this.dlg.set(null);
      this.toasts.ok('Organigrama actualizado');
    } catch (e) { this.toasts.error(e); } finally { this.busy.set(false); }
  }

  async remove() {
    const d = this.dlg()!;
    if (!d.id || !confirm(`¿Eliminar el área «${d.name}»? Sus áreas dependientes subirán un nivel.`)) return;
    try {
      await this.api.deleteDept(d.id);
      this.depts.set(await this.api.org());
      this.dlg.set(null);
      this.toasts.ok('Área eliminada');
    } catch (e) { this.toasts.error(e); }
  }
}
