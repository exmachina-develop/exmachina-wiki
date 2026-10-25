import { Component, HostListener, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Doc, DocVersion, PageSettings } from '../core/models';
import { SpacesStore } from '../core/spaces.store';
import { Toasts } from '../core/toast.service';
import { EditorComponent } from '../editor/editor.component';
import { AvatarComponent, IconComponent, ModalComponent, relTime } from '../shared/ui';

@Component({
  selector: 'app-doc',
  standalone: true,
  imports: [FormsModule, RouterLink, EditorComponent, IconComponent, AvatarComponent, ModalComponent],
  template: `
    @if (doc(); as d) {
      <div class="bar no-print">
        <nav class="crumbs">
          <a [routerLink]="['/spaces', d.space.key]">{{ d.space.icon }} {{ d.space.name }}</a><x-icon name="chevronR" /><span class="cur">{{ title || 'Sin título' }}</span>
        </nav>
        <div class="right">
          <span class="status eyebrow" [class.err]="status() === 'error'">{{ statusText() }}</span>
          @if (d.access.canEdit) {
            <button class="btn sm" [class.ghost]="!editing()" (click)="toggleEdit()"><x-icon [name]="editing() ? 'eye' : 'edit'" /> <span class="lbl">{{ editing() ? 'Ver' : 'Editar' }}</span></button>
          }
          <button class="btn ghost sm" (click)="openHistory()"><x-icon name="history" /> <span class="lbl">Historial</span></button>
          @if (d.access.canExport) {
            <button class="btn ghost sm" (click)="exportPdf()" [disabled]="exporting()">
              @if (exporting()) { <span class="spinner"></span> } @else { <x-icon name="download" /> } <span class="lbl">PDF</span>
            </button>
          }
          <div class="menu-wrap">
            <button class="btn ghost sm icon" (click)="menu.set(!menu())" aria-label="Más opciones"><x-icon name="more" /></button>
            @if (menu()) {
              <div class="menu" (click)="menu.set(false)">
                @if (d.access.canEdit) {
                  <button (click)="openPage()"><x-icon name="file2" /> Ajustes de página</button>
                  <button (click)="saveVersion()"><x-icon name="save" /> Guardar versión</button>
                }
                @if (d.sourceFileId) { <button (click)="openOriginal()"><x-icon name="pdf" /> Ver PDF original</button> }
                @if (d.access.canDelete) { <button class="del" (click)="confirmDelete.set(true)"><x-icon name="trash" /> Eliminar</button> }
              </div>
            }
          </div>
        </div>
      </div>

      @if (imported() && editing()) {
        <div class="notice no-print"><x-icon name="pdf" /><span>Documento importado desde PDF. Revisa el formato antes de compartirlo.@if (d.sourceFileId) { <a (click)="openOriginal()">Ver PDF original</a> }</span><button class="btn subtle icon sm" (click)="imported.set(false)" aria-label="Cerrar"><x-icon name="close" /></button></div>
      }

      <div class="head">
        @if (editing()) {
          <input class="title-input" [(ngModel)]="title" (ngModelChange)="changed()" placeholder="Título del documento" maxlength="250" aria-label="Título">
        } @else { <h1 class="title-input ro">{{ d.title }}</h1> }
        <div class="byline muted">
          @if (d.author) { <x-avatar size="sm" [name]="d.author.name" [color]="d.author.color" /> <span>{{ d.author.name }}</span><span class="dot">·</span> }
          <span>Actualizado {{ rel(d.updatedAt) }}@if (d.updatedBy && d.updatedBy.id !== d.author?.id) { por {{ d.updatedBy.name }} }</span>
        </div>
      </div>

      <app-editor [content]="d.content" [editable]="editing()" [settings]="settings()" (contentChange)="onContent($event)" />

      @if (pageDlg()) {
        <x-modal (closed)="pageDlg.set(false)">
          <h2>Ajustes de página</h2>
          <div class="field"><label for="ps">Tamaño</label><select id="ps" class="select" [(ngModel)]="draft.size"><option value="A4">A4 (210 × 297 mm)</option><option value="Letter">Carta (216 × 279 mm)</option></select></div>
          <div class="field"><label for="po">Orientación</label><select id="po" class="select" [(ngModel)]="draft.orientation"><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></div>
          <div class="field"><label for="pm">Márgenes: {{ draft.margin }} mm</label><input id="pm" type="range" min="5" max="50" step="1" [(ngModel)]="draft.margin"></div>
          <p class="muted" style="font-size:13px">Estos ajustes se aplican también al exportar a PDF.</p>
          <div class="modal-actions"><button class="btn ghost" (click)="pageDlg.set(false)">Cancelar</button><button class="btn" (click)="savePage()">Aplicar</button></div>
        </x-modal>
      }

      @if (confirmDelete()) {
        <x-modal (closed)="confirmDelete.set(false)">
          <h2>¿Eliminar documento?</h2>
          <p class="muted">«{{ d.title }}» se eliminará junto con su historial. Las subpáginas se conservarán. Esta acción no se puede deshacer.</p>
          <div class="modal-actions"><button class="btn ghost" (click)="confirmDelete.set(false)">Cancelar</button><button class="btn danger" (click)="remove()">Eliminar</button></div>
        </x-modal>
      }

      @if (history()) {
        <x-modal [wide]="true" (closed)="closeHistory()">
          <h2>Historial de versiones</h2>
          @if (!versions().length) { <p class="muted">Todavía no hay versiones anteriores. Se guardan automáticamente al editar.</p> }
          <div class="vlist">
            @for (v of versions(); track v.id) {
              <div class="vrow" [class.sel]="preview()?.id === v.id">
                <button class="vmain" (click)="showVersion(v)">
                  <b>{{ v.title }}</b>
                  <small>{{ fmt(v.createdAt) }} · {{ v.author?.name || 'Desconocido' }}@if (v.note) { · {{ v.note }} }</small>
                </button>
                @if (d.access.canEdit) { <button class="btn ghost sm" (click)="restore(v)">Restaurar</button> }
              </div>
            }
          </div>
          @if (preview()) { <div class="vprev"><span class="eyebrow">Vista previa</span><div class="paper vp" [innerHTML]="previewHtml()"></div></div> }
          <div class="modal-actions"><button class="btn ghost" (click)="closeHistory()">Cerrar</button></div>
        </x-modal>
      }
    } @else if (error()) { <div class="page"><div class="empty">{{ error() }}</div></div> }
    @else { <div class="page"><div class="empty"><span class="spinner"></span></div></div> }`,
  styles: [`
    :host { display: block; --sticky-top: var(--topbar-h-doc, 56px); }
    .bar { position: sticky; top: 0; z-index: 30; height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 20px; background: rgba(5,5,9,.92); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); min-width: 0; a:hover { color: var(--white); } x-icon { width: 13px; height: 13px; flex: none; } .cur { color: var(--white); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
    .right { display: flex; align-items: center; gap: 8px; flex: none; }
    .status { margin-right: 6px; &.err { color: var(--danger); } }
    .menu-wrap { position: relative; } .menu { position: absolute; right: 0; top: 38px; min-width: 210px; background: var(--surface-3); border: 1px solid var(--line-strong); padding: 6px; z-index: 40; animation: fade .15s; button { display: flex; align-items: center; gap: 12px; width: 100%; height: 38px; padding: 0 12px; font-size: 14px; color: var(--muted); text-align: left; &:hover { background: rgba(244,244,247,.06); color: var(--white); } &.del:hover { color: var(--danger); } x-icon { width: 16px; height: 16px; } } }
    .notice { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: rgba(112,71,255,.1); border-bottom: 1px solid rgba(112,71,255,.35); font-size: 14px; span { flex: 1; } a { margin-left: 8px; color: #b9a6ff; text-decoration: underline; cursor: pointer; } }
    .head { max-width: 210mm; margin: 0 auto; padding: 36px 16px 0; }
    .title-input { width: 100%; background: transparent; border: 0; border-bottom: 1px solid transparent; font-size: clamp(30px, 4.4vw, 48px); font-weight: 300; letter-spacing: -.035em; line-height: 1.08; color: var(--white); padding: 0 0 12px; word-break: break-word; &:focus { outline: none; border-bottom-color: var(--violet); } &::placeholder { color: var(--gray); } &.ro { margin: 0; } }
    .byline { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 0 4px; flex-wrap: wrap; } .byline .dot { opacity: .5; }
    .vlist { display: flex; flex-direction: column; border: 1px solid var(--line); max-height: 260px; overflow: auto; } .vrow { display: flex; align-items: center; gap: 10px; padding: 4px 12px; border-bottom: 1px solid var(--line); &:last-child { border: 0; } &.sel { background: rgba(112,71,255,.1); } }
    .vmain { flex: 1; text-align: left; padding: 8px 0; display: flex; flex-direction: column; min-width: 0; b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--gray-light); font-size: 12px; } }
    .vprev { margin-top: 20px; .vp { zoom: .6; margin-top: 10px; min-height: 0; max-height: 520px; overflow: auto; width: 100% !important; padding: 28px; } }
    @media (max-width: 900px) { .bar { padding: 0 10px; top: var(--topbar-h); } .lbl, .status { display: none; } .crumbs a { display: none; } .crumbs x-icon { display: none; } :host { --sticky-top: calc(var(--topbar-h) + 56px); } .head { padding-top: 24px; } }
  `],
})
export class DocComponent implements OnDestroy {
  private api = inject(Api);
  private router = inject(Router);
  private toasts = inject(Toasts);
  private store = inject(SpacesStore);
  private sanitizer = inject(DomSanitizer);

  id = input.required<string>();
  edit = input<string>();
  importedQ = input<string>('', { alias: 'imported' });

  doc = signal<Doc | null>(null);
  error = signal('');
  editing = signal(false);
  status = signal<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  savedAt = signal<Date | null>(null);
  menu = signal(false);
  pageDlg = signal(false);
  confirmDelete = signal(false);
  exporting = signal(false);
  history = signal(false);
  versions = signal<DocVersion[]>([]);
  preview = signal<DocVersion | null>(null);
  previewHtml = signal<SafeHtml>('');
  imported = signal(false);
  settings = computed<PageSettings | null>(() => this.doc()?.pageSettings ?? null);
  draft: PageSettings = { size: 'A4', orientation: 'portrait', margin: 20 };
  rel = relTime;

  title = '';
  private pendingContent: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private saving = false;

  statusText = computed(() => {
    switch (this.status()) {
      case 'dirty': return 'Sin guardar…';
      case 'saving': return 'Guardando…';
      case 'error': return 'Error al guardar';
      case 'saved': return 'Guardado';
      default: return '';
    }
  });

  constructor() {
    effect(() => { const id = this.id(); this.edit(); this.importedQ(); untracked(() => this.load(id)); });
  }

  async load(id: string) {
    await this.flush();
    this.doc.set(null); this.error.set('');
    try {
      const d = await this.api.doc(id);
      this.doc.set(d);
      this.title = d.title;
      this.status.set('idle');
      this.editing.set(!!this.edit() && d.access.canEdit);
      this.imported.set(!!this.importedQ());
    } catch (e: any) {
      this.error.set(e?.status === 403 ? 'No tienes acceso a este documento.' : 'Documento no encontrado.');
    }
  }

  toggleEdit() {
    if (this.editing()) this.flush();
    this.editing.update((v) => !v);
  }

  onContent(html: string) { this.pendingContent = html; this.changed(); }
  changed() {
    this.status.set('dirty');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 1500);
  }

  /** Persist pending title/content changes (also used on leave). */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    const d = this.doc();
    if (!d || this.status() !== 'dirty' || this.saving) return;
    const body: { title?: string; content?: string } = {};
    if (this.title.trim() !== d.title) body.title = this.title;
    if (this.pendingContent !== null) body.content = this.pendingContent;
    if (!Object.keys(body).length) return this.status.set('idle');
    this.saving = true;
    this.status.set('saving');
    const sentContent = this.pendingContent;
    try {
      const u = await this.api.saveDoc(d.id, body);
      // Keep the editor content untouched (the user may have kept typing); only refresh metadata.
      // (never write content back into `doc`: the editor input would reset the caret while typing)
      this.doc.update((cur) => (cur ? { ...cur, title: u.title, updatedAt: u.updatedAt, updatedBy: u.updatedBy } : cur));
      if (this.pendingContent === sentContent) this.pendingContent = null;
      this.status.set(this.pendingContent === null ? 'saved' : 'dirty');
      this.savedAt.set(new Date());
      if (body.title) this.store.reload();
    } catch (e) {
      this.status.set('error');
      this.toasts.error(e, 'No se pudo guardar el documento');
    } finally {
      this.saving = false;
      if (this.status() === 'dirty') this.timer = setTimeout(() => this.flush(), 800);
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(e: BeforeUnloadEvent) { if (this.status() === 'dirty' || this.status() === 'saving') { this.flush(); e.preventDefault(); } }
  ngOnDestroy() { this.flush(); }

  async exportPdf() {
    const d = this.doc()!;
    await this.flush();
    this.exporting.set(true);
    try {
      const blob = await this.api.exportPdf(d.id);
      this.download(blob, `${d.title.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '').trim() || 'documento'}.pdf`);
    } catch (e: any) {
      this.toasts.show(e?.error instanceof Blob ? 'No se pudo exportar el PDF' : e?.error?.message || 'No se pudo exportar el PDF', 'error');
    } finally { this.exporting.set(false); }
  }

  async openOriginal() {
    try {
      const blob = await this.api.fileBlob(this.doc()!.sourceFileId!);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (e) { this.toasts.error(e, 'No se pudo abrir el PDF original'); }
  }

  private download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  openPage() { this.draft = { ...(this.doc()!.pageSettings) }; this.pageDlg.set(true); }

  async savePage() {
    this.pageDlg.set(false);
    try {
      const u = await this.api.saveDoc(this.doc()!.id, { pageSettings: { ...this.draft, margin: +this.draft.margin } });
      this.doc.update((cur) => (cur ? { ...cur, pageSettings: u.pageSettings } : cur));
    } catch (e) { this.toasts.error(e); }
  }

  async saveVersion() {
    await this.flush();
    try { await this.api.saveDoc(this.doc()!.id, { snapshot: true }); this.toasts.ok('Versión guardada'); } catch (e) { this.toasts.error(e); }
  }

  async remove() {
    const d = this.doc()!;
    try {
      await this.api.deleteDoc(d.id);
      this.status.set('idle');
      this.confirmDelete.set(false);
      this.toasts.ok('Documento eliminado');
      this.router.navigate(['/spaces', d.space.key]);
    } catch (e) { this.toasts.error(e); }
  }

  async openHistory() {
    await this.flush();
    this.history.set(true); this.preview.set(null);
    try { this.versions.set(await this.api.versions(this.doc()!.id)); } catch (e) { this.toasts.error(e); }
  }
  closeHistory() { this.history.set(false); this.preview.set(null); }
  async showVersion(v: DocVersion) {
    try {
      const full = await this.api.version(this.doc()!.id, v.id);
      this.preview.set(v);
      // Content was sanitized server-side on save; the preview needs inline styles, which Angular would strip.
      this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(full.content ?? ''));
    } catch (e) { this.toasts.error(e); }
  }
  async restore(v: DocVersion) {
    try {
      const d = await this.api.restore(this.doc()!.id, v.id);
      this.doc.set(d); this.title = d.title; this.pendingContent = null; this.status.set('idle');
      this.closeHistory(); this.toasts.ok('Versión restaurada');
    } catch (e) { this.toasts.error(e); }
  }

  fmt(iso: string) { return new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }); }

  @HostListener('document:keydown', ['$event'])
  keys(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.status.set('dirty'); this.flush(); }
  }
}
