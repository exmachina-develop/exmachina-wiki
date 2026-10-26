import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Toasts } from '../core/toast.service';
import { IconComponent } from '../shared/ui';

const PT_PER_PX = 0.75;
const PALETTE = ['#14141a', '#626262', '#7047ff', '#416bff', '#0f9d7a', '#d98a00', '#d6335a', '#ffffff'];
const BG_SWATCHES = ['#ffffff', '#f4f4f7', '#050509', '#14141a', '#ece7ff', '#e4f5ee', '#fdf0d8', '#7047ff'];
const RADII = [0, 4, 8, 12, 20, 40];

type Drag = { mode: 'move' | 'resize' | 'resizew'; el: HTMLElement; x: number; y: number; left: number; top: number; w: number; h: number };

/**
 * Page-faithful editor for imported PDFs. Every page is a fixed-size sheet made of layers:
 *   .pbg  background image chosen by the user (optional)   .pfg  the original artwork   .shp / .pimg  added shapes & images   .tb  text boxes
 * Text boxes are editable in place; boxes, shapes and images can be moved, added and removed; page colour, background
 * image and the original artwork can be changed per page or for all pages. The stored value is plain, server-sanitized HTML.
 */
@Component({
  selector: 'app-pages-editor',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (editable) {
      <div class="toolbar no-print" role="toolbar" aria-label="Formato">
        <div class="grp">
          <select class="sel w-font" [value]="fmt().family" (mousedown)="saveSel()" (change)="setFamily($any($event.target).value)" aria-label="Fuente" title="Fuente">
            @for (f of fonts; track f) { <option [value]="f" [selected]="f === fmt().family" [style.font-family]="f">{{ f }}</option> }
            @if (!fonts.includes(fmt().family) && fmt().family) { <option [value]="fmt().family" selected>{{ fmt().family }}</option> }
          </select>
          <select class="sel w-weight" (mousedown)="saveSel()" (change)="setWeight($any($event.target).value)" aria-label="Peso de la letra" title="Peso">
            @for (w of weights; track w[0]) { <option [value]="w[0]" [selected]="w[0] === fmt().weight">{{ w[1] }}</option> }
          </select>
          <div class="size">
            <button class="tb sm" (mousedown)="$event.preventDefault()" (click)="stepSize(-1)" aria-label="Reducir tamaño"><x-icon name="minus" /></button>
            <input class="sz" type="number" min="3" max="200" step="0.5" [value]="fmt().size" (mousedown)="saveSel()" (change)="setSize($any($event.target).value)" (keydown.enter)="setSize($any($event.target).value)" aria-label="Tamaño de letra (pt)" title="Tamaño (pt)">
            <button class="tb sm" (mousedown)="$event.preventDefault()" (click)="stepSize(1)" aria-label="Aumentar tamaño"><x-icon name="plus" /></button>
          </div>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="fmt().align === 'left'" (mousedown)="$event.preventDefault()" (click)="align('left')" title="Alinear a la izquierda" aria-label="Alinear a la izquierda"><x-icon name="alignLeft" /></button>
          <button class="tb" [class.on]="fmt().align === 'center'" (mousedown)="$event.preventDefault()" (click)="align('center')" title="Centrar" aria-label="Centrar"><x-icon name="alignCenter" /></button>
          <button class="tb" [class.on]="fmt().align === 'right'" (mousedown)="$event.preventDefault()" (click)="align('right')" title="Alinear a la derecha" aria-label="Alinear a la derecha"><x-icon name="alignRight" /></button>
          <button class="tb" [class.on]="fmt().align === 'justify'" (mousedown)="$event.preventDefault()" (click)="align('justify')" title="Justificar" aria-label="Justificar"><x-icon name="alignJustify" /></button>
        </div>
        <div class="grp">
          <button class="tb" [class.on]="fmt().bold" (mousedown)="$event.preventDefault()" (click)="cmd('bold')" title="Negrita" aria-label="Negrita"><x-icon name="bold" /></button>
          <button class="tb" [class.on]="fmt().italic" (mousedown)="$event.preventDefault()" (click)="cmd('italic')" title="Cursiva" aria-label="Cursiva"><x-icon name="italic" /></button>
          <button class="tb" [class.on]="fmt().underline" (mousedown)="$event.preventDefault()" (click)="cmd('underline')" title="Subrayado" aria-label="Subrayado"><x-icon name="underline" /></button>
          <div class="pop-wrap">
            <button class="tb" (mousedown)="$event.preventDefault()" (click)="togglePop('text')" title="Color del texto" aria-label="Color del texto"><span class="swatch-a">A</span></button>
            @if (pop() === 'text') {
              <div class="pop"><div class="sw">@for (c of palette; track c) { <button class="dot" (mousedown)="$event.preventDefault()" [style.background]="c" (click)="textColor(c)" [attr.aria-label]="c"></button> }</div>
                <input type="color" class="cp" (input)="textColor($any($event.target).value)" aria-label="Color personalizado"></div>
            }
          </div>
        </div>

        <div class="grp">
          <div class="pop-wrap">
            <button class="tb txt" [class.on]="pop() === 'bg'" (mousedown)="$event.preventDefault()" (click)="togglePop('bg')" title="Editar el fondo de la página"><x-icon name="image" /> Fondo</button>
            @if (pop() === 'bg') {
              <div class="pop bgpop" (mousedown)="$event.stopPropagation()">
                <span class="eyebrow">Fondo de la página {{ pageNo() }}</span>
                <div class="row"><label>Color</label><input type="color" class="cp sm" [value]="pageColor()" (input)="setPageColor($any($event.target).value)" aria-label="Color de fondo"></div>
                <div class="sw">@for (c of bgSwatches; track c) { <button class="dot" [style.background]="c" (click)="setPageColor(c)" [attr.aria-label]="c"></button> }</div>
                <button class="btn ghost sm" (click)="bgFile.click()"><x-icon name="upload" /> Imagen de fondo…</button>
                <input #bgFile type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden (change)="pickBg($event)">
                <button class="btn subtle sm" (click)="clearBgImage()" [disabled]="!hasBgImage()">Quitar imagen de fondo</button>
                <label class="check"><input type="checkbox" [checked]="origVisible()" (change)="toggleOriginal($any($event.target).checked)"> Mostrar el diseño original</label>
                <label class="check"><input type="checkbox" [checked]="allPages()" (change)="allPages.set($any($event.target).checked)"> Aplicar a todas las páginas</label>
                <small class="muted">El «diseño original» incluye tarjetas, formas, logos e imágenes del PDF. Ocúltalo para dejar solo el color o tu imagen.</small>
              </div>
            }
          </div>
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="addShape()" title="Añadir recuadro de color"><x-icon name="plus" /> Recuadro</button>
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="imgFile.click()" title="Añadir imagen"><x-icon name="plus" /> Imagen</button>
          <input #imgFile type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden (change)="pickImage($event)">
        </div>

        <div class="grp">
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="addBox()" title="Añadir caja de texto"><x-icon name="plus" /> Texto</button>
          @if (selKind() === 'shp') {
            <input type="color" class="cp sm" [value]="shapeColor()" (input)="setShapeColor($any($event.target).value)" aria-label="Relleno del recuadro" title="Relleno">
            <select class="sel" (change)="setRadius($any($event.target).value)" aria-label="Esquinas" title="Esquinas">
              @for (r of radii; track r) { <option [value]="r" [selected]="r === shapeRadius()">{{ r === 0 ? 'Rectas' : 'Radio ' + r }}</option> }
            </select>
          }
          <button class="tb danger" (mousedown)="$event.preventDefault()" (click)="removeSel()" [disabled]="!selKind()" title="Eliminar lo seleccionado (Supr)" aria-label="Eliminar lo seleccionado"><x-icon name="trash" /></button>
        </div>
        <span class="hint">Selecciona parte del texto para formatearla, o solo haz clic para formatear toda la caja · ✥ mueve · borde derecho ensancha · recuadros e imágenes: arrastra y usa la esquina ◢</span>
      </div>
    }
    <div class="stage" #stage>
      <div class="sheet-zoom" [style.zoom]="zoom()" [class.editing]="editable" #host></div>
    </div>`,
  styles: [`
    :host { display: block; }
    .toolbar { position: sticky; top: var(--sticky-top, 0px); z-index: 20; display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; padding: 8px 12px; background: var(--glass); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .grp { display: flex; align-items: center; gap: 2px; padding-right: 8px; margin-right: 2px; border-right: 1px solid var(--line); }
    .tb { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 2px; color: var(--muted); &:hover:not(:disabled) { background: var(--hover-2); color: var(--white); } &.on { background: rgba(112,71,255,.2); color: var(--white); } &:disabled { opacity: .3; cursor: default; } &.txt { width: auto; padding: 0 10px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; } &.danger:hover { color: var(--danger); } }
    .tb x-icon { width: 17px; height: 17px; } .txt x-icon { width: 14px; height: 14px; }
    .swatch-a { font-weight: 600; font-size: 14px; border-bottom: 3px solid var(--violet); line-height: 1; padding: 0 2px 1px; }
    .pop-wrap { position: relative; }
    .pop { position: absolute; top: 38px; left: 0; z-index: 30; background: var(--surface-3); border: 1px solid var(--line-strong); padding: 12px; display: flex; flex-direction: column; gap: 10px; width: 200px; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
    .pop.bgpop { width: 270px; } .row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
    .pop .btn { width: 100%; justify-content: flex-start; } .pop small { font-size: 12px; line-height: 1.4; }
    .sw { display: flex; flex-wrap: wrap; gap: 6px; } .dot { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line-strong); }
    .cp { width: 100%; height: 30px; background: transparent; border: 1px solid var(--line); cursor: pointer; padding: 0; } .cp.sm { width: 38px; height: 28px; }
    .sel { height: 30px; background: transparent; border: 1px solid var(--line); border-radius: 2px; font-size: 13px; padding: 0 6px; color: var(--white); margin: 0 4px; option { background: var(--surface-2); } }
    .w-font { width: 138px; } .w-weight { width: 104px; } .size { display: flex; align-items: center; }
    .tb.sm { width: 24px; height: 30px; } .tb.sm x-icon { width: 13px; height: 13px; }
    .sz { width: 54px; height: 30px; text-align: center; background: transparent; border: 1px solid var(--line); border-radius: 2px; font-size: 13px; color: var(--white); padding: 0 2px; -moz-appearance: textfield; &:focus { outline: none; border-color: var(--violet); } &::-webkit-inner-spin-button { display: none; } }
    .hint { font-size: 12px; color: var(--gray-light); margin-left: auto; }
    .stage { padding: 28px 12px 120px; overflow-x: auto; background: var(--stage); }
    @media (max-width: 900px) { .toolbar { flex-wrap: nowrap; overflow-x: auto; } .grp { flex: none; } .hint { display: none; } .stage { padding: 10px 0 100px; } .pop { position: fixed; left: 12px; right: 12px; top: auto; bottom: 12px; width: auto !important; } }
  `],
})
export class PagesEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private zone = inject(NgZone);
  private api = inject(Api);
  private toasts = inject(Toasts);
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @Input() content = '';
  @Input() editable = false;
  @Output() contentChange = new EventEmitter<string>();

  palette = PALETTE;
  bgSwatches = BG_SWATCHES;
  radii = RADII;
  pop = signal<'' | 'text' | 'bg'>('');
  zoom = signal(1);
  selKind = signal<'' | 'tb' | 'shp' | 'img'>('');
  allPages = signal(false);
  fonts = ['Lexend', 'Unbounded', 'Urbanist', 'Inter', 'Roboto', 'Open Sans', 'Lora', 'Arial', 'Times New Roman', 'Georgia', 'Courier New'];
  weights: [string, string][] = [['300', 'Ligera'], ['400', 'Normal'], ['500', 'Media'], ['600', 'Seminegrita'], ['700', 'Negrita'], ['800', 'Extranegrita']];
  /** formatting of the current selection / box, shown in the toolbar */
  fmt = signal({ family: '', weight: '400', size: '' as string | number, align: 'left', bold: false, italic: false, underline: false });
  private savedRange: Range | null = null;
  private tick = signal(0);
  private sel: HTMLElement | null = null;
  private activePage: HTMLElement | null = null;
  private ro?: ResizeObserver;
  private drag: Drag | null = null;
  private last = '';

  ngAfterViewInit() {
    this.load(this.content);
    const el = this.host.nativeElement;
    el.addEventListener('input', this.onInput);
    el.addEventListener('focusin', this.onFocusIn);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('paste', this.onPaste);
    el.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('selectionchange', this.onSelectionChange);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.ro = new ResizeObserver(() => this.zone.run(() => this.fit()));
    this.ro.observe(this.stage.nativeElement);
  }

  ngOnChanges(c: SimpleChanges) {
    if (!this.host) return;
    if (c['content'] && this.content !== this.last) this.load(this.content);
    if (c['editable']) this.applyEditable();
  }

  ngOnDestroy() {
    this.ro?.disconnect();
    document.removeEventListener('selectionchange', this.onSelectionChange);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  // ---- rendering ----
  private load(html: string) {
    // `html` was sanitized by the API when it was saved.
    this.host.nativeElement.innerHTML = html;
    this.last = html;
    this.sel = null;
    this.activePage = null;
    this.selKind.set('');
    this.applyEditable();
    setTimeout(() => this.fit());
  }

  private applyEditable() {
    this.host.nativeElement.querySelectorAll<HTMLElement>('.tb').forEach((tb) => {
      if (this.editable) { tb.setAttribute('contenteditable', 'true'); tb.setAttribute('spellcheck', 'false'); }
      else tb.removeAttribute('contenteditable');
    });
    if (!this.editable) this.clearSel();
  }

  private fit() {
    const first = this.host.nativeElement.querySelector<HTMLElement>('.pdf-page');
    const wPt = first ? parseFloat(first.style.width) : 0;
    if (!wPt) return this.zoom.set(1);
    const px = (wPt * 96) / 72;
    const avail = this.stage.nativeElement.clientWidth - (window.innerWidth <= 900 ? 8 : 24);
    this.zoom.set(Math.min(1.3, Math.max(0.25, avail / px)));
  }

  private serialize(): string {
    const clone = this.host.nativeElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[contenteditable]').forEach((e) => { e.removeAttribute('contenteditable'); e.removeAttribute('spellcheck'); });
    clone.querySelectorAll('.sel, .act').forEach((e) => e.classList.remove('sel', 'act'));
    return clone.innerHTML; // already wrapped in <div class="pdfpages">
  }

  private emit() {
    this.last = this.serialize();
    this.zone.run(() => {
      this.tick.update((n) => n + 1);
      this.contentChange.emit(this.last);
    });
  }

  // ---- selection ----
  private clearSel() {
    this.sel?.classList.remove('sel');
    this.sel = null;
    this.zone.run(() => this.selKind.set(''));
  }

  private select(el: HTMLElement) {
    if (this.sel !== el) this.sel?.classList.remove('sel');
    this.sel = el;
    el.classList.add('sel');
    this.zone.run(() => this.selKind.set(el.classList.contains('tb') ? 'tb' : el.classList.contains('shp') ? 'shp' : 'img'));
  }

  private setActivePage(page: HTMLElement) {
    if (this.activePage === page) return;
    this.activePage?.classList.remove('act');
    this.activePage = page;
    page.classList.add('act');
    this.zone.run(() => this.tick.update((n) => n + 1));
  }

  /** the page being edited: the last one touched, else the most visible one */
  private currentPage(): HTMLElement | null {
    if (this.activePage?.isConnected) return this.activePage;
    const pages = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.pdf-page'));
    if (!pages.length) return null;
    const mid = window.innerHeight / 2;
    const dist = (p: HTMLElement) => { const r = p.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - mid); };
    return pages.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  }

  private targets(): HTMLElement[] {
    if (this.allPages()) return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.pdf-page'));
    const p = this.currentPage();
    return p ? [p] : [];
  }

  // ---- editing events ----
  private onInput = () => this.emit();

  private onFocusIn = (e: Event) => {
    const tb = (e.target as HTMLElement).closest?.('.tb') as HTMLElement | null;
    if (tb) {
      this.select(tb);
      const page = tb.closest('.pdf-page') as HTMLElement | null;
      if (page) this.setActivePage(page);
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement).closest?.('.tb')) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  };

  @HostListener('document:keydown', ['$event'])
  docKey(e: KeyboardEvent) {
    if (!this.editable || !this.sel || this.sel.classList.contains('tb')) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.removeSel(); }
  }

  private onPaste = (e: ClipboardEvent) => {
    if (!(e.target as HTMLElement).closest?.('.tb')) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.editable) return;
    this.zone.run(() => this.pop.set(''));
    const t = e.target as HTMLElement;
    const page = t.closest('.pdf-page') as HTMLElement | null;
    if (page) this.setActivePage(page);
    const obj = t.closest('.shp, .pimg') as HTMLElement | null;
    if (obj) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.select(obj);
      const r = obj.getBoundingClientRect();
      const k = PT_PER_PX / this.zoom();
      const corner = e.clientX > r.right - 18 && e.clientY > r.bottom - 18;
      this.drag = {
        mode: corner ? 'resize' : 'move', el: obj, x: e.clientX, y: e.clientY,
        left: parseFloat(obj.style.left) || 0, top: parseFloat(obj.style.top) || 0,
        w: parseFloat(obj.style.width) || r.width * k, h: parseFloat(obj.style.height) || r.height * k,
      };
      return;
    }
    const tb = t.closest('.tb') as HTMLElement | null;
    if (tb) {
      // drag by the ✥ handle (the ::before area left of the box)
      if (tb.classList.contains('sel') && e.offsetX < 0) {
        e.preventDefault();
        this.drag = { mode: 'move', el: tb, x: e.clientX, y: e.clientY, left: parseFloat(tb.style.left) || 0, top: parseFloat(tb.style.top) || 0, w: 0, h: 0 };
      } else if (tb.classList.contains('sel') && e.offsetX > tb.clientWidth) {
        e.preventDefault();
        const k = PT_PER_PX / this.zoom();
        this.drag = { mode: 'resizew', el: tb, x: e.clientX, y: e.clientY, left: 0, top: 0, w: parseFloat(tb.style.width) || tb.getBoundingClientRect().width * k, h: 0 };
      }
      return;
    }
    this.clearSel();
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    const k = PT_PER_PX / this.zoom();
    const dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k;
    if (d.mode === 'resizew') {
      d.el.style.width = `${Math.max(12, d.w + dx).toFixed(2)}pt`;
    } else if (d.mode === 'move') {
      d.el.style.left = `${(d.left + dx).toFixed(2)}pt`;
      d.el.style.top = `${(d.top + dy).toFixed(2)}pt`;
    } else {
      const w = Math.max(8, d.w + dx);
      d.el.style.width = `${w.toFixed(2)}pt`;
      d.el.style.height = `${(d.el.classList.contains('pimg') ? (w * d.h) / d.w : Math.max(8, d.h + dy)).toFixed(2)}pt`;
    }
  };

  private onPointerUp = () => {
    if (this.drag) { this.drag = null; this.emit(); }
  };

  // ---- text toolbar ----
  togglePop(p: 'text' | 'bg') {
    this.pop.set(this.pop() === p ? '' : p);
    if (p === 'bg') { const cp = this.currentPage(); if (cp) this.setActivePage(cp); }
  }

  cmd(name: 'bold' | 'italic' | 'underline') {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(name);
    this.emit();
  }

  textColor(c: string) {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, c);
    this.pop.set('');
    this.emit();
  }

  /** Scale the whole selected text box (font sizes + line pitch) by one step. */
  resize(dir: 1 | -1) {
    if (!this.sel?.classList.contains('tb')) return;
    const k = dir > 0 ? 1.1 : 1 / 1.1;
    const tb = this.sel;
    tb.style.lineHeight = `${((parseFloat(tb.style.lineHeight) || 12) * k).toFixed(2)}pt`;
    const base = parseFloat(tb.style.fontSize);
    if (base) tb.style.fontSize = `${(base * k).toFixed(2)}pt`;
    tb.querySelectorAll<HTMLElement>('span').forEach((s) => {
      const v = parseFloat(s.style.fontSize);
      if (v) s.style.fontSize = `${(v * k).toFixed(2)}pt`;
      const ls = parseFloat(s.style.letterSpacing);
      if (ls) s.style.letterSpacing = `${(ls * k).toFixed(2)}pt`;
    });
    this.emit();
  }

  addBox() {
    const page = this.currentPage();
    if (!page) return;
    const tb = document.createElement('div');
    tb.className = 'tb';
    tb.setAttribute('style', "left: 48pt; top: 48pt; line-height: 14pt; font-family: 'Lexend', sans-serif; font-size: 10.00pt; font-weight: 300");
    tb.innerHTML = `<span style="font-family: 'Lexend', sans-serif; font-size: 10.00pt; color: #14141a; font-weight: 300">Nuevo texto</span>`;
    page.appendChild(tb);
    this.applyEditable();
    tb.focus();
    document.getSelection()?.selectAllChildren(tb);
    this.emit();
  }

  removeSel() {
    if (!this.sel) return;
    this.sel.remove();
    this.clearSel();
    this.emit();
  }

  // ---- background / page ----
  pageNo(): number {
    this.tick();
    const p = this.currentPage();
    return p ? Array.from(this.host.nativeElement.querySelectorAll('.pdf-page')).indexOf(p) + 1 : 1;
  }

  pageColor(): string {
    this.tick();
    const p = this.currentPage();
    return p ? this.toHex(getComputedStyle(p).backgroundColor) : '#ffffff';
  }

  origVisible(): boolean {
    this.tick();
    const f = this.currentPage()?.querySelector('.pfg');
    return !!f && !f.classList.contains('off');
  }

  hasBgImage(): boolean {
    this.tick();
    return !!this.currentPage()?.querySelector('.pbg');
  }

  setPageColor(c: string) {
    this.targets().forEach((p) => (p.style.backgroundColor = c));
    this.emit();
  }

  toggleOriginal(show: boolean) {
    this.targets().forEach((p) => p.querySelector('.pfg')?.classList.toggle('off', !show));
    this.emit();
  }

  clearBgImage() {
    this.targets().forEach((p) => p.querySelector('.pbg')?.remove());
    this.emit();
  }

  async pickBg(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const r = await this.api.uploadImage(f);
      this.targets().forEach((p) => {
        let bg = p.querySelector<HTMLElement>('.pbg');
        if (!bg) {
          bg = document.createElement('div');
          bg.className = 'pbg';
          p.insertBefore(bg, p.firstChild);
        }
        bg.setAttribute('style', `background-image: url(${r.url}); background-size: cover; background-position: center`);
        // the original artwork would cover the new image: hide it so the choice is visible (it can be shown again)
        p.querySelector('.pfg')?.classList.add('off');
      });
      this.emit();
    } catch (e) { this.toasts.error(e, 'No se pudo subir la imagen'); }
  }

  // ---- shapes & images ----
  addShape() {
    const page = this.currentPage();
    if (!page) return;
    const sh = document.createElement('div');
    sh.className = 'shp';
    sh.setAttribute('style', 'left: 60pt; top: 60pt; width: 220pt; height: 110pt; background-color: #7047ff; border-radius: 10pt');
    page.insertBefore(sh, page.querySelector('.tb')); // under the text
    this.select(sh);
    this.emit();
  }

  async pickImage(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    const page = this.currentPage();
    if (!f || !page) return;
    try {
      const r = await this.api.uploadImage(f);
      const dim = await new Promise<{ w: number; h: number }>((res) => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res({ w: 4, h: 3 });
        im.src = r.url;
      });
      const w = 200, h = (w * dim.h) / dim.w;
      const img = document.createElement('div');
      img.className = 'pimg';
      img.setAttribute('style', `left: 60pt; top: 60pt; width: ${w}pt; height: ${h.toFixed(2)}pt; background-image: url(${r.url})`);
      page.insertBefore(img, page.querySelector('.tb'));
      this.select(img);
      this.emit();
    } catch (e) { this.toasts.error(e, 'No se pudo subir la imagen'); }
  }

  shapeColor(): string {
    this.tick();
    return this.sel?.classList.contains('shp') ? this.toHex(getComputedStyle(this.sel).backgroundColor) : '#7047ff';
  }

  shapeRadius(): number {
    this.tick();
    return this.sel ? Math.round(parseFloat(this.sel.style.borderRadius) || 0) : 0;
  }

  setShapeColor(c: string) {
    if (!this.sel?.classList.contains('shp')) return;
    this.sel.style.backgroundColor = c;
    this.emit();
  }

  setRadius(v: string) {
    if (!this.sel?.classList.contains('shp')) return;
    this.sel.style.borderRadius = `${+v}pt`;
    this.emit();
  }

  private toHex(css: string): string {
    const m = css.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return '#ffffff';
    return '#' + m.slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('');
  }

  // ---- font / weight / size / alignment (read from, and applied to, the selection or the whole box) ----
  private selectedTb(): HTMLElement | null {
    if (this.sel?.classList.contains('tb')) return this.sel;
    const n = document.getSelection()?.anchorNode;
    const el = (n instanceof HTMLElement ? n : n?.parentElement) ?? null;
    const tb = el?.closest('.tb') as HTMLElement | null;
    return tb && this.host.nativeElement.contains(tb) ? tb : null;
  }

  private onSelectionChange = () => {
    if (!this.editable) return;
    const s = document.getSelection();
    const n = s?.anchorNode;
    const el = (n instanceof HTMLElement ? n : n?.parentElement) ?? null;
    const tb = el?.closest('.tb') as HTMLElement | null;
    if (tb && this.host.nativeElement.contains(tb)) {
      if (s && s.rangeCount) this.savedRange = s.getRangeAt(0).cloneRange();
      this.readFormat(el!, tb);
    }
  };

  private readFormat(el: HTMLElement, tb: HTMLElement) {
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const pt = parseFloat(cs.fontSize) * PT_PER_PX;
    let align = getComputedStyle(tb).textAlign;
    if (align === 'start') align = 'left';
    if (align === 'end') align = 'right';
    const w = Math.round(+cs.fontWeight / 100) * 100;
    this.zone.run(() => this.fmt.set({
      family: fam, weight: String(w || 400), size: Math.round(pt * 10) / 10, align,
      bold: +cs.fontWeight >= 600, italic: cs.fontStyle === 'italic', underline: cs.textDecorationLine.includes('underline'),
    }));
  }

  /** keep the text selection while a toolbar <select>/<input> takes focus */
  saveSel() {
    const s = document.getSelection();
    if (s && s.rangeCount && this.selectedTb()) this.savedRange = s.getRangeAt(0).cloneRange();
  }

  private restoreSel() {
    const s = document.getSelection();
    if (this.savedRange && s) { s.removeAllRanges(); s.addRange(this.savedRange); }
  }

  /** Apply inline styles to the selected text (wrapping it in a span), or to the whole box when nothing is selected. */
  private applyStyle(props: Record<string, string>) {
    const tb = this.selectedTb();
    if (!tb) return;
    this.restoreSel();
    const sel = document.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const apply = (e: HTMLElement) => Object.entries(props).forEach(([k, v]) => e.style.setProperty(k, v));
    if (range && !range.collapsed && tb.contains(range.commonAncestorContainer)) {
      const span = document.createElement('span');
      span.appendChild(range.extractContents());
      apply(span);
      span.querySelectorAll<HTMLElement>('span').forEach(apply); // inner runs carry their own styles
      range.insertNode(span);
      sel!.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel!.addRange(r);
      this.savedRange = r.cloneRange();
    } else {
      apply(tb);
      tb.querySelectorAll<HTMLElement>('span').forEach(apply);
      if ('font-size' in props) {
        // keep the line pitch proportional to the new size
        const old = parseFloat(this.fmt().size as string) || parseFloat(props['font-size']);
        const nw = parseFloat(props['font-size']);
        const lh = parseFloat(tb.style.lineHeight);
        if (lh && old) tb.style.lineHeight = `${((lh * nw) / old).toFixed(2)}pt`;
      }
    }
    this.emit();
    this.readFormat(tb, tb);
  }

  setFamily(name: string) {
    const generic = ['Times New Roman', 'Georgia', 'Lora'].includes(name) ? 'serif' : name === 'Courier New' ? 'monospace' : 'sans-serif';
    this.applyStyle({ 'font-family': `'${name}', ${generic}` });
  }

  setWeight(w: string) { this.applyStyle({ 'font-weight': w }); }

  setSize(v: string) {
    const n = Math.min(200, Math.max(3, parseFloat(v)));
    if (!isNaN(n)) this.applyStyle({ 'font-size': `${n.toFixed(2)}pt` });
  }

  stepSize(dir: 1 | -1) {
    const cur = parseFloat(this.fmt().size as string) || 10;
    this.setSize(String(Math.max(3, cur + dir * (cur < 14 ? 0.5 : 1))));
  }

  align(a: 'left' | 'center' | 'right' | 'justify') {
    const tb = this.selectedTb();
    if (!tb) return;
    // alignment only has an effect inside a box of fixed width: freeze the current one (drag the right edge to change it)
    if (!tb.style.width) tb.style.width = `${(tb.getBoundingClientRect().width / this.zoom() * PT_PER_PX).toFixed(2)}pt`;
    tb.style.textAlign = a;
    tb.style.setProperty('text-align-last', a === 'justify' ? 'justify' : 'auto');
    this.emit();
    this.readFormat(tb, tb);
  }
}
