import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { DirUser, DocBrief, Space, SpaceMemberView, SpaceRole } from '../core/models';
import { SpacesStore } from '../core/spaces.store';
import { Toasts } from '../core/toast.service';
import { AvatarComponent, IconComponent, ModalComponent, relTime } from '../shared/ui';
import { SpaceFormComponent } from '../shared/space-form.component';

interface Node { doc: DocBrief; children: Node[]; depth: number }

@Component({
  selector: 'app-space',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, AvatarComponent, ModalComponent, SpaceFormComponent],
  template: `
    @if (space(); as s) {
      <div class="page">
        <header class="page-head">
          <div>
            <span class="eyebrow">{{ s.key }} · {{ s.visibility === 'private' ? 'Espacio privado' : 'Espacio de empresa' }}</span>
            <h1 class="title-xl"><span class="ico">{{ s.icon }}</span> {{ s.name }}</h1>
            @if (s.description) { <p class="muted desc">{{ s.description }}</p> }
          </div>
          <div class="actions">
            @if (s.access?.canEdit && auth.can('documents.create')) {
              <button class="btn" (click)="create(null)" [disabled]="busy()"><x-icon name="plus" /> Nuevo documento</button>
              @if (auth.can('documents.import')) {
                <button class="btn ghost" (click)="file.click()" [disabled]="busy()"><x-icon name="upload" /> Importar PDF</button>
                <input #file type="file" accept="application/pdf" hidden (change)="importPdf($event)">
              }
            }
            @if (s.access?.canManage) {
              <button class="btn ghost icon" (click)="members.set(true)" title="Miembros" aria-label="Miembros"><x-icon name="users" /></button>
              <button class="btn ghost icon" (click)="settings.set(true)" title="Ajustes" aria-label="Ajustes"><x-icon name="settings" /></button>
            }
          </div>
        </header>

        @if (busy()) { <div class="banner"><span class="spinner"></span> {{ busyText() }}</div> }

        @if (!tree().length) {
          <div class="empty">Este espacio aún no tiene documentos.@if (s.access?.canEdit) { <br>Crea uno desde cero o importa un PDF para editarlo. }</div>
        } @else {
          <div class="tree">
            @for (n of flat(); track n.doc.id) {
              <div class="node" [style.--d]="n.depth">
                <a class="main" [routerLink]="['/doc', n.doc.id]">
                  <x-icon [name]="n.doc.source === 'pdf' ? 'pdf' : 'file'" />
                  <b>{{ n.doc.icon }} {{ n.doc.title }}</b>
                </a>
                <span class="meta">
                  @if (n.doc.updatedBy) { <x-avatar size="sm" [name]="n.doc.updatedBy.name" [color]="n.doc.updatedBy.color" /> }
                  <span class="eyebrow">{{ rel(n.doc.updatedAt) }}</span>
                </span>
                @if (s.access?.canEdit && auth.can('documents.create')) {
                  <button class="btn subtle icon sm" (click)="create(n.doc.id)" title="Nueva subpágina" aria-label="Nueva subpágina"><x-icon name="plus" /></button>
                }
              </div>
            }
          </div>
        }
      </div>

      @if (settings()) { <app-space-form [space]="s" (closed)="settings.set(false)" (saved)="onSaved($event)" /> }

      @if (members()) {
        <x-modal [wide]="true" (closed)="members.set(false)">
          <h2>Miembros de {{ s.name }}</h2>
          <p class="muted" style="margin:-12px 0 20px;font-size:14px">En espacios de empresa, los miembros con rol «Lector» solo pueden leer. En espacios privados, solo los miembros acceden.</p>
          <div class="mlist">
            @for (m of draft(); track m.userId) {
              <div class="mrow">
                <x-avatar [name]="m.name" [color]="m.color" /><span class="mn"><b>{{ m.name }}</b><small>{{ m.email }}</small></span>
                <select class="select" [ngModel]="m.role" (ngModelChange)="setRole(m.userId, $event)" [attr.aria-label]="'Rol de ' + m.name">
                  <option value="admin">Administrador</option><option value="editor">Editor</option><option value="viewer">Lector</option>
                </select>
                <button class="btn subtle icon sm" (click)="removeMember(m.userId)" aria-label="Quitar"><x-icon name="close" /></button>
              </div>
            }
          </div>
          <div class="field" style="margin-top:18px">
            <label for="addm">Añadir miembro</label>
            <select id="addm" class="select" (change)="addMember($any($event.target).value); $any($event.target).value = ''">
              <option value="">Selecciona una persona…</option>
              @for (u of candidates(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
            </select>
          </div>
          <div class="modal-actions"><button class="btn ghost" (click)="members.set(false)">Cancelar</button><button class="btn" (click)="saveMembers()">Guardar</button></div>
        </x-modal>
      }
    } @else if (error()) { <div class="page"><div class="empty">{{ error() }}</div></div> }
    @else { <div class="page"><div class="empty"><span class="spinner"></span></div></div> }`,
  styles: [`
    .ico { color: var(--violet); } .desc { max-width: 560px; margin-top: 14px; }
    .banner { display: flex; gap: 12px; align-items: center; padding: 14px 18px; border: 1px solid rgba(112,71,255,.4); background: rgba(112,71,255,.08); margin-bottom: 20px; font-size: 14px; }
    .tree { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
    .node { display: flex; align-items: center; gap: 12px; padding: 4px 12px 4px calc(16px + var(--d) * 28px); border-bottom: 1px solid var(--line); min-height: 56px; &:last-child { border-bottom: 0; } &:hover { background: var(--surface-2); } }
    .main { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; height: 52px; color: var(--white); x-icon { color: var(--gray-light); } b { font-weight: 400; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .meta { display: flex; gap: 10px; align-items: center; }
    .mlist { display: flex; flex-direction: column; gap: 8px; } .mrow { display: grid; grid-template-columns: 32px 1fr 160px 30px; gap: 12px; align-items: center; } .mn { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; } .mn small { color: var(--gray-light); font-size: 12px; overflow: hidden; text-overflow: ellipsis; } .mn b { font-weight: 400; } .mrow .select { height: 36px; font-size: 13px; }
    @media (max-width: 640px) { .meta .eyebrow { display: none; } .mrow { grid-template-columns: 32px 1fr 30px; } .mrow .select { grid-column: 2 / 3; grid-row: 2; } }
  `],
})
export class SpaceComponent {
  private api = inject(Api);
  private router = inject(Router);
  private toasts = inject(Toasts);
  private store = inject(SpacesStore);
  auth = inject(Auth);
  key = input.required<string>();
  space = signal<Space | null>(null);
  docs = signal<DocBrief[]>([]);
  error = signal('');
  busy = signal(false);
  busyText = signal('');
  settings = signal(false);
  members = signal(false);
  draft = signal<SpaceMemberView[]>([]);
  users = signal<DirUser[]>([]);
  rel = relTime;

  tree = computed<Node[]>(() => {
    const byParent = new Map<string | null, DocBrief[]>();
    const ids = new Set(this.docs().map((d) => d.id));
    for (const d of this.docs()) {
      const p = d.parentId && ids.has(d.parentId) ? d.parentId : null;
      byParent.set(p, [...(byParent.get(p) ?? []), d]);
    }
    const build = (p: string | null, depth: number): Node[] =>
      (byParent.get(p) ?? []).map((doc) => ({ doc, depth, children: build(doc.id, depth + 1) }));
    return build(null, 0);
  });
  flat = computed(() => {
    const out: Node[] = [];
    const walk = (ns: Node[]) => ns.forEach((n) => { out.push(n); walk(n.children); });
    walk(this.tree());
    return out;
  });
  candidates = computed(() => this.users().filter((u) => u.active && !this.draft().some((m) => m.userId === u.id)));

  constructor() {
    effect(() => { this.load(this.key()); }, { allowSignalWrites: true });
    effect(() => {
      if (this.members()) this.api.users().then((u) => this.users.set(u));
    }, { allowSignalWrites: true });
  }

  async load(key: string) {
    this.space.set(null);
    this.error.set('');
    try {
      const s = await this.api.space(key);
      this.space.set(s);
      this.draft.set([...(s.members ?? [])]);
      this.docs.set(await this.api.docs(s.id));
    } catch (e: any) {
      this.error.set(e?.status === 403 ? 'No tienes acceso a este espacio.' : 'Espacio no encontrado.');
    }
  }

  async create(parentId: string | null) {
    const s = this.space()!;
    this.busy.set(true); this.busyText.set('Creando documento…');
    try {
      const d = await this.api.createDoc({ spaceId: s.id, parentId, title: 'Documento sin título' });
      this.router.navigate(['/doc', d.id], { queryParams: { edit: 1 } });
    } catch (e) { this.toasts.error(e); } finally { this.busy.set(false); }
  }

  async importPdf(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return this.toasts.show('El PDF supera los 50 MB', 'error');
    this.busy.set(true); this.busyText.set(`Importando «${f.name}»… esto puede tardar unos segundos`);
    try {
      const r = await this.api.importPdf(f, this.space()!.id);
      this.toasts.ok(`PDF importado (${r.pages} páginas)`);
      this.router.navigate(['/doc', r.document.id], { queryParams: { edit: 1, imported: 1 } });
    } catch (e) { this.toasts.error(e, 'No se pudo importar el PDF'); } finally { this.busy.set(false); }
  }

  onSaved(s: Space) { this.settings.set(false); this.store.reload(); this.space.set({ ...this.space()!, ...s }); }

  setRole(userId: string, role: SpaceRole) { this.draft.update((l) => l.map((m) => (m.userId === userId ? { ...m, role } : m))); }
  removeMember(userId: string) { this.draft.update((l) => l.filter((m) => m.userId !== userId)); }
  addMember(userId: string) {
    const u = this.users().find((x) => x.id === userId);
    if (u) this.draft.update((l) => [...l, { userId: u.id, name: u.name, email: u.email, color: u.color, role: 'editor' }]);
  }
  async saveMembers() {
    try {
      const s = await this.api.setSpaceMembers(this.space()!.id, this.draft().map((m) => ({ userId: m.userId, role: m.role })));
      this.space.set(s); this.members.set(false); this.toasts.ok('Miembros actualizados'); this.store.reload();
    } catch (e) { this.toasts.error(e); }
  }
}
