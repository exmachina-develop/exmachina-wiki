import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Editor } from '@tiptap/core';
import { Api } from '../core/api.service';
import { Toasts } from '../core/toast.service';
import { PageSettings } from '../core/models';
import { IconComponent, ModalComponent } from '../shared/ui';
import { buildExtensions } from './extensions';

export const FONTS = [
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Roboto', value: 'Roboto, sans-serif' },
  { label: 'Open Sans', value: "'Open Sans', sans-serif" },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Lora', value: 'Lora, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: "'Courier New', monospace" },
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'];
const PALETTE = ['#14141a', '#626262', '#7047ff', '#416bff', '#0f9d7a', '#d98a00', '#d6335a', '#ffffff'];
const HIGHLIGHTS = ['#fff1a8', '#ffd6e0', '#cfe3ff', '#d4f5e4', '#e4d9ff'];

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    @if (editable) {
      <div class="toolbar no-print" role="toolbar" aria-label="Formato">
        <div class="grp">
          <button class="tb" (click)="run('undo')" [disabled]="!can('undo')" title="Deshacer (Ctrl+Z)" aria-label="Deshacer"><x-icon name="undo" /></button>
          <button class="tb" (click)="run('redo')" [disabled]="!can('redo')" title="Rehacer (Ctrl+Y)" aria-label="Rehacer"><x-icon name="redo" /></button>
        </div>
        <div class="grp">
          <select class="sel w-style" [ngModel]="blockStyle()" (ngModelChange)="setBlock($event)" aria-label="Estilo de párrafo">
            <option value="p">Párrafo</option><option value="1">Título 1</option><option value="2">Título 2</option><option value="3">Título 3</option><option value="4">Título 4</option>
          </select>
          <select class="sel w-font" [ngModel]="fontFamily()" (ngModelChange)="setFont($event)" aria-label="Fuente">
            <option value="">Fuente</option>
            @for (f of fonts; track f.value) { <option [value]="f.value" [style.font-family]="f.value">{{ f.label }}</option> }
          </select>
          <div class="size">
            <button class="tb sm" (click)="stepSize(-1)" aria-label="Reducir tamaño"><x-icon name="minus" /></button>
            <select class="sel w-size" [ngModel]="fontSize()" (ngModelChange)="setSize($event)" aria-label="Tamaño de letra (pt)">
              <option value="">–</option>
              @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
            </select>
            <button class="tb sm" (click)="stepSize(1)" aria-label="Aumentar tamaño"><x-icon name="plus" /></button>
          </div>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="active('bold')" (click)="run('toggleBold')" title="Negrita (Ctrl+B)" aria-label="Negrita"><x-icon name="bold" /></button>
          <button class="tb" [class.on]="active('italic')" (click)="run('toggleItalic')" title="Cursiva (Ctrl+I)" aria-label="Cursiva"><x-icon name="italic" /></button>
          <button class="tb" [class.on]="active('underline')" (click)="run('toggleUnderline')" title="Subrayado (Ctrl+U)" aria-label="Subrayado"><x-icon name="underline" /></button>
          <button class="tb" [class.on]="active('strike')" (click)="run('toggleStrike')" title="Tachado" aria-label="Tachado"><x-icon name="strike" /></button>
          <button class="tb" [class.on]="active('subscript')" (click)="run('toggleSubscript')" title="Subíndice" aria-label="Subíndice"><x-icon name="sub" /></button>
          <button class="tb" [class.on]="active('superscript')" (click)="run('toggleSuperscript')" title="Superíndice" aria-label="Superíndice"><x-icon name="sup" /></button>
          <div class="pop-wrap">
            <button class="tb" (click)="pop.set(pop() === 'color' ? '' : 'color')" title="Color de texto" aria-label="Color de texto"><span class="swatch-a" [style.border-color]="textColor() || '#f4f4f7'">A</span></button>
            @if (pop() === 'color') {
              <div class="pop"><div class="sw">@for (c of palette; track c) { <button class="dot" [style.background]="c" (click)="setColor(c)" [attr.aria-label]="c"></button> }</div>
                <input type="color" class="cp" (input)="setColor($any($event.target).value)" aria-label="Color personalizado">
                <button class="btn subtle sm" (click)="setColor(null)">Quitar color</button></div>
            }
          </div>
          <div class="pop-wrap">
            <button class="tb" [class.on]="active('highlight')" (click)="pop.set(pop() === 'hl' ? '' : 'hl')" title="Resaltado" aria-label="Resaltado"><x-icon name="highlight" /></button>
            @if (pop() === 'hl') {
              <div class="pop"><div class="sw">@for (c of highlights; track c) { <button class="dot" [style.background]="c" (click)="setHighlight(c)" [attr.aria-label]="c"></button> }</div>
                <button class="btn subtle sm" (click)="setHighlight(null)">Quitar resaltado</button></div>
            }
          </div>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="alignIs('left')" (click)="align('left')" title="Alinear a la izquierda" aria-label="Alinear a la izquierda"><x-icon name="alignLeft" /></button>
          <button class="tb" [class.on]="alignIs('center')" (click)="align('center')" title="Centrar" aria-label="Centrar"><x-icon name="alignCenter" /></button>
          <button class="tb" [class.on]="alignIs('right')" (click)="align('right')" title="Alinear a la derecha" aria-label="Alinear a la derecha"><x-icon name="alignRight" /></button>
          <button class="tb" [class.on]="alignIs('justify')" (click)="align('justify')" title="Justificar" aria-label="Justificar"><x-icon name="alignJustify" /></button>
          <select class="sel w-lh" [ngModel]="lineHeight()" (ngModelChange)="setLineHeight($event)" aria-label="Interlineado" title="Interlineado">
            <option value="">Interlineado</option>
            @for (s of spacings; track s) { <option [value]="s">{{ s }}</option> }
          </select>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="active('bulletList')" (click)="run('toggleBulletList')" title="Lista con viñetas" aria-label="Lista con viñetas"><x-icon name="listUl" /></button>
          <button class="tb" [class.on]="active('orderedList')" (click)="run('toggleOrderedList')" title="Lista numerada" aria-label="Lista numerada"><x-icon name="listOl" /></button>
          <button class="tb" [class.on]="active('blockquote')" (click)="run('toggleBlockquote')" title="Cita" aria-label="Cita"><x-icon name="quote" /></button>
          <button class="tb" [class.on]="active('codeBlock')" (click)="run('toggleCodeBlock')" title="Bloque de código" aria-label="Bloque de código"><x-icon name="code" /></button>
          <button class="tb" (click)="run('setHorizontalRule')" title="Línea divisoria" aria-label="Línea divisoria"><x-icon name="hr" /></button>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="active('link')" (click)="openLink()" title="Enlace" aria-label="Enlace"><x-icon name="link" /></button>
          <button class="tb" (click)="img.click()" title="Insertar imagen" aria-label="Insertar imagen"><x-icon name="image" /></button>
          <input #img type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden (change)="pickImage($event)">
          <button class="tb" (click)="tableDlg.set(true)" title="Insertar tabla" aria-label="Insertar tabla"><x-icon name="table" /></button>
        </div>
        @if (inTable()) {
          <div class="grp tbl">
            <button class="tb" (click)="tbl('addRowBefore')" title="Fila arriba" aria-label="Fila arriba"><x-icon name="rowAdd" /></button>
            <button class="tb" (click)="tbl('addRowAfter')" title="Fila abajo" aria-label="Fila abajo"><x-icon name="rowAdd" /></button>
            <button class="tb" (click)="tbl('addColumnBefore')" title="Columna a la izquierda" aria-label="Columna a la izquierda"><x-icon name="colAdd" /></button>
            <button class="tb" (click)="tbl('addColumnAfter')" title="Columna a la derecha" aria-label="Columna a la derecha"><x-icon name="colAdd" /></button>
            <button class="tb" (click)="tbl('mergeOrSplit')" title="Combinar / dividir celdas" aria-label="Combinar o dividir celdas"><x-icon name="merge" /></button>
            <button class="tb" (click)="tbl('toggleHeaderRow')" title="Fila de encabezado" aria-label="Fila de encabezado"><x-icon name="listUl" /></button>
            <div class="pop-wrap">
              <button class="tb" (click)="pop.set(pop() === 'cell' ? '' : 'cell')" title="Color de celda" aria-label="Color de celda"><x-icon name="highlight" /></button>
              @if (pop() === 'cell') { <div class="pop"><div class="sw">@for (c of cellColors; track c) { <button class="dot" [style.background]="c" (click)="cellBg(c)" [attr.aria-label]="c"></button> }</div><button class="btn subtle sm" (click)="cellBg(null)">Sin color</button></div> }
            </div>
            <button class="tb" (click)="tbl('deleteRow')" title="Eliminar fila" aria-label="Eliminar fila"><x-icon name="minus" /></button>
            <button class="tb" (click)="tbl('deleteColumn')" title="Eliminar columna" aria-label="Eliminar columna"><x-icon name="close" /></button>
            <button class="tb danger" (click)="tbl('deleteTable')" title="Eliminar tabla" aria-label="Eliminar tabla"><x-icon name="trash" /></button>
          </div>
        }
        @if (imageSelected()) {
          <div class="grp">
            @for (w of [25, 50, 75, 100]; track w) { <button class="tb txt" (click)="imgWidth(w)">{{ w }}%</button> }
          </div>
        }
      </div>
    }

    <div class="stage" #stage>
      <div class="paper" [class.landscape]="settings?.orientation === 'landscape'" [class.letter]="settings?.size === 'Letter'"
           [style.--paper-pad]="(settings?.margin ?? 20) + 'mm'" [style.zoom]="zoom()" (click)="pop.set('')">
        <div #host></div>
      </div>
    </div>

    @if (tableDlg()) {
      <x-modal (closed)="tableDlg.set(false)">
        <h2>Insertar tabla</h2>
        <div class="two"><div class="field"><label for="tr">Filas</label><input id="tr" class="input" type="number" min="1" max="30" [(ngModel)]="rows"></div>
          <div class="field"><label for="tc">Columnas</label><input id="tc" class="input" type="number" min="1" max="10" [(ngModel)]="cols"></div></div>
        <label class="check"><input type="checkbox" [(ngModel)]="headerRow"> Primera fila como encabezado</label>
        <div class="modal-actions"><button class="btn ghost" (click)="tableDlg.set(false)">Cancelar</button><button class="btn" (click)="insertTable()">Insertar</button></div>
      </x-modal>
    }
    @if (linkDlg()) {
      <x-modal (closed)="linkDlg.set(false)">
        <h2>Enlace</h2>
        <div class="field"><label for="lk">URL</label><input id="lk" class="input" [(ngModel)]="linkUrl" placeholder="https://…" (keyup.enter)="applyLink()"></div>
        <div class="modal-actions"><button class="btn danger" (click)="linkUrl = ''; applyLink()">Quitar</button><button class="btn" (click)="applyLink()">Aplicar</button></div>
      </x-modal>
    }`,
  styles: [`
    :host { display: block; }
    .toolbar { position: sticky; top: var(--sticky-top, 0px); z-index: 20; display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; padding: 8px 12px; background: rgba(10,10,16,.94); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .grp { display: flex; align-items: center; gap: 2px; padding-right: 8px; margin-right: 2px; border-right: 1px solid var(--line); &:last-child { border-right: 0; } }
    .tb { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 2px; color: var(--muted); transition: background .15s, color .15s; &:hover:not(:disabled) { background: rgba(244,244,247,.08); color: var(--white); } &.on { background: rgba(112,71,255,.25); color: #fff; } &:disabled { opacity: .3; cursor: default; } &.sm { width: 24px; height: 28px; } &.danger:hover { color: var(--danger); } &.txt { width: auto; padding: 0 8px; font-size: 12px; } }
    .tb x-icon { width: 17px; height: 17px; } .tb.sm x-icon { width: 13px; height: 13px; }
    .sel { height: 32px; background: transparent; border: 1px solid var(--line); border-radius: 2px; font-size: 13px; padding: 0 6px; color: var(--white); cursor: pointer; &:hover { border-color: var(--line-strong); } option { background: var(--surface-2); } }
    .w-style { width: 104px; } .w-font { width: 128px; } .w-size { width: 52px; text-align: center; padding: 0 2px; } .w-lh { width: 100px; }
    .size { display: flex; align-items: center; }
    .swatch-a { font-weight: 600; font-size: 14px; border-bottom: 3px solid; line-height: 1; padding: 0 2px 1px; }
    .pop-wrap { position: relative; }
    .pop { position: absolute; top: 38px; left: 0; z-index: 30; background: var(--surface-3); border: 1px solid var(--line-strong); padding: 10px; display: flex; flex-direction: column; gap: 8px; width: 190px; animation: fade .15s; }
    .sw { display: flex; flex-wrap: wrap; gap: 6px; } .dot { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line-strong); }
    .cp { width: 100%; height: 30px; background: transparent; border: 1px solid var(--line); cursor: pointer; }
    .stage { padding: 32px 16px 120px; overflow-x: auto; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 900px) {
      .toolbar { flex-wrap: nowrap; overflow-x: auto; padding: 6px 8px; } .grp { flex: none; }
      .stage { padding: 12px 0 100px; } :host ::ng-deep .paper { width: 100%; min-height: 70vh; padding: 20px 18px; box-shadow: none; zoom: 1 !important; }
    }
  `],
})
export class EditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private api = inject(Api);
  private toasts = inject(Toasts);
  private zone = inject(NgZone);
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @Input() content = '';
  @Input() editable = false;
  @Input() settings: PageSettings | null = null;
  @Output() contentChange = new EventEmitter<string>();

  editor?: Editor;
  fonts = FONTS; sizes = SIZES; spacings = SPACINGS; palette = PALETTE; highlights = HIGHLIGHTS;
  cellColors = ['#f1f1f6', '#e4d9ff', '#cfe3ff', '#d4f5e4', '#fff1a8', '#ffd6e0'];
  pop = signal('');
  tableDlg = signal(false);
  linkDlg = signal(false);
  zoom = signal(1);
  rows = 3; cols = 3; headerRow = true; linkUrl = '';
  private ro?: ResizeObserver;
  private tick = signal(0);

  ngAfterViewInit() {
    this.editor = new Editor({
      element: this.host.nativeElement,
      extensions: buildExtensions('Empieza a escribir…'),
      content: this.content,
      editable: this.editable,
      editorProps: {
        attributes: { class: 'doc-content', spellcheck: 'true', lang: 'es' },
        handlePaste: (_v, ev) => this.handleFiles(ev.clipboardData?.files),
        handleDrop: (_v, ev) => this.handleFiles((ev as DragEvent).dataTransfer?.files),
      },
      onUpdate: ({ editor }) => this.zone.run(() => this.contentChange.emit(editor.getHTML())),
      onTransaction: () => this.zone.run(() => this.tick.update((n) => n + 1)),
    });
    this.ro = new ResizeObserver(() => this.zone.run(() => this.fit()));
    this.ro.observe(this.stage.nativeElement);
  }

  ngOnChanges(c: SimpleChanges) {
    if (!this.editor) return;
    if (c['editable']) this.editor.setEditable(this.editable);
    if (c['content'] && this.content !== this.editor.getHTML()) this.editor.commands.setContent(this.content, false);
    if (c['settings']) setTimeout(() => this.fit());
  }

  ngOnDestroy() { this.ro?.disconnect(); this.editor?.destroy(); }

  /** Scale the physical-size sheet down when the column is narrower than the paper (desktop only). */
  private fit() {
    if (window.innerWidth <= 900) return this.zoom.set(1);
    const paper = this.host.nativeElement.parentElement!;
    const mm = this.settings?.size === 'Letter' ? (this.settings.orientation === 'landscape' ? 279.4 : 215.9) : this.settings?.orientation === 'landscape' ? 297 : 210;
    const px = (mm / 25.4) * 96;
    const avail = this.stage.nativeElement.clientWidth - 32;
    void paper;
    this.zoom.set(Math.min(1, Math.max(0.5, avail / px)));
  }

  // ---- state helpers (re-evaluated on every transaction) ----
  private t() { this.tick(); }
  can(cmd: 'undo' | 'redo') { this.t(); return !!this.editor && (cmd === 'undo' ? this.editor.can().undo() : this.editor.can().redo()); }
  active(name: string) { this.t(); return !!this.editor?.isActive(name); }
  alignIs(a: string) { this.t(); return !!this.editor?.isActive({ textAlign: a }); }
  inTable() { this.t(); return !!this.editor?.isActive('table'); }
  imageSelected() { this.t(); return !!this.editor?.isActive('image'); }
  blockStyle() { this.t(); const e = this.editor; if (!e) return 'p'; for (const l of [1, 2, 3, 4]) if (e.isActive('heading', { level: l })) return String(l); return 'p'; }
  fontFamily() { this.t(); return this.editor?.getAttributes('textStyle')['fontFamily'] ?? ''; }
  fontSize() { this.t(); return String(this.editor?.getAttributes('textStyle')['fontSize'] ?? '').replace('pt', ''); }
  textColor() { this.t(); return this.editor?.getAttributes('textStyle')['color'] ?? ''; }
  lineHeight() { this.t(); const e = this.editor; return (e?.getAttributes('paragraph')['lineHeight'] ?? e?.getAttributes('heading')['lineHeight'] ?? '') as string; }

  // ---- commands ----
  run(cmd: string) { (this.editor!.chain().focus() as any)[cmd]().run(); }
  setBlock(v: string) { const c = this.editor!.chain().focus(); (v === 'p' ? c.setParagraph() : c.setHeading({ level: +v as 1 | 2 | 3 | 4 })).run(); }
  setFont(v: string) { const c = this.editor!.chain().focus(); (v ? c.setFontFamily(v) : c.unsetFontFamily()).run(); }
  setSize(v: string) { const c = this.editor!.chain().focus(); (v ? c.setFontSize(`${v}pt`) : c.unsetFontSize()).run(); }
  stepSize(dir: 1 | -1) {
    const cur = +(this.fontSize() || 11);
    const next = dir > 0 ? SIZES.find((s) => s > cur) : [...SIZES].reverse().find((s) => s < cur);
    if (next) this.setSize(String(next));
  }
  setColor(c: string | null) { const ch = this.editor!.chain().focus(); (c ? ch.setColor(c) : ch.unsetColor()).run(); this.pop.set(''); }
  setHighlight(c: string | null) { const ch = this.editor!.chain().focus(); (c ? ch.setHighlight({ color: c }) : ch.unsetHighlight()).run(); this.pop.set(''); }
  align(a: string) { this.editor!.chain().focus().setTextAlign(a).run(); }
  setLineHeight(v: string) { const c = this.editor!.chain().focus(); (v ? c.setLineHeight(v) : c.unsetLineHeight()).run(); }
  tbl(cmd: string) {
    const c = this.editor!.chain().focus() as any;
    if (cmd === 'mergeOrSplit') c.mergeOrSplit().run(); else c[cmd]().run();
  }
  cellBg(color: string | null) {
    this.editor!.chain().focus().setCellAttribute('backgroundColor', color).run();
    this.pop.set('');
  }
  insertTable() {
    const rows = Math.min(30, Math.max(1, +this.rows || 3)), cols = Math.min(10, Math.max(1, +this.cols || 3));
    this.editor!.chain().focus().insertTable({ rows, cols, withHeaderRow: this.headerRow }).run();
    this.tableDlg.set(false);
  }
  openLink() { this.linkUrl = this.editor!.getAttributes('link')['href'] ?? ''; this.linkDlg.set(true); }
  applyLink() {
    const c = this.editor!.chain().focus().extendMarkRange('link');
    const url = this.linkUrl.trim();
    if (!url) c.unsetLink().run();
    else c.setLink({ href: /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}` }).run();
    this.linkDlg.set(false);
  }
  imgWidth(pct: number) {
    const el = this.editor!.view.dom.querySelector('img.ProseMirror-selectednode') as HTMLImageElement | null;
    const full = this.host.nativeElement.clientWidth || 700;
    void el;
    this.editor!.chain().focus().updateAttributes('image', { width: Math.round((full * pct) / 100) }).run();
  }

  async pickImage(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = input.files;
    await this.upload(files);
    input.value = '';
  }
  private handleFiles(files?: FileList | null): boolean {
    const imgs = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return false;
    this.upload(files);
    return true;
  }
  private async upload(files?: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) { this.toasts.show('Formato de imagen no admitido', 'error'); continue; }
      try {
        const r = await this.api.uploadImage(f);
        this.editor!.chain().focus().setImage({ src: r.url, alt: f.name }).run();
      } catch (e) { this.toasts.error(e, 'No se pudo subir la imagen'); }
    }
  }
}
