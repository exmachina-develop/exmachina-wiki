import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, inject, signal } from '@angular/core';
import { IconComponent } from '../shared/ui';

const PT_PER_PX = 0.75;
const PALETTE = ['#14141a', '#626262', '#7047ff', '#416bff', '#0f9d7a', '#d98a00', '#d6335a', '#ffffff'];

/**
 * Page-faithful editor for imported PDFs. Each page is a fixed-size sheet (background image + positioned text boxes).
 * Text boxes are editable in place; boxes can be moved, added and removed. The stored value is plain (server-sanitized) HTML.
 */
@Component({
  selector: 'app-pages-editor',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (editable) {
      <div class="toolbar no-print" role="toolbar" aria-label="Formato">
        <div class="grp">
          <button class="tb" (mousedown)="$event.preventDefault()" (click)="cmd('bold')" title="Negrita" aria-label="Negrita"><x-icon name="bold" /></button>
          <button class="tb" (mousedown)="$event.preventDefault()" (click)="cmd('italic')" title="Cursiva" aria-label="Cursiva"><x-icon name="italic" /></button>
          <button class="tb" (mousedown)="$event.preventDefault()" (click)="cmd('underline')" title="Subrayado" aria-label="Subrayado"><x-icon name="underline" /></button>
          <div class="pop-wrap">
            <button class="tb" (mousedown)="$event.preventDefault()" (click)="pop.set(!pop())" title="Color del texto" aria-label="Color del texto"><span class="swatch-a">A</span></button>
            @if (pop()) {
              <div class="pop"><div class="sw">@for (c of palette; track c) { <button class="dot" (mousedown)="$event.preventDefault()" [style.background]="c" (click)="color(c)" [attr.aria-label]="c"></button> }</div>
                <input type="color" class="cp" (input)="color($any($event.target).value)" aria-label="Color personalizado"></div>
            }
          </div>
        </div>
        <div class="grp">
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="resize(-1)" title="Reducir texto" aria-label="Reducir texto">A−</button>
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="resize(1)" title="Aumentar texto" aria-label="Aumentar texto">A+</button>
        </div>
        <div class="grp">
          <button class="tb txt" (mousedown)="$event.preventDefault()" (click)="addBox()"><x-icon name="plus" /> Texto</button>
          <button class="tb danger" (mousedown)="$event.preventDefault()" (click)="removeBox()" [disabled]="!hasSel()" title="Eliminar caja de texto" aria-label="Eliminar caja de texto"><x-icon name="trash" /></button>
        </div>
        <span class="hint">Clic en un texto para editarlo · arrastra el asa ✥ para moverlo</span>
      </div>
    }
    <div class="stage" #stage>
      <div class="sheet-zoom" [style.zoom]="zoom()" [class.editing]="editable" #host></div>
    </div>`,
  styles: [`
    :host { display: block; }
    .toolbar { position: sticky; top: var(--sticky-top, 0px); z-index: 20; display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; padding: 8px 12px; background: var(--glass); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .grp { display: flex; align-items: center; gap: 2px; padding-right: 8px; margin-right: 2px; border-right: 1px solid var(--line); }
    .tb { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 2px; color: var(--muted); &:hover:not(:disabled) { background: var(--hover-2); color: var(--white); } &:disabled { opacity: .3; cursor: default; } &.txt { width: auto; padding: 0 10px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; } &.danger:hover { color: var(--danger); } }
    .tb x-icon { width: 17px; height: 17px; } .txt x-icon { width: 14px; height: 14px; }
    .swatch-a { font-weight: 600; font-size: 14px; border-bottom: 3px solid var(--violet); line-height: 1; padding: 0 2px 1px; }
    .pop-wrap { position: relative; } .pop { position: absolute; top: 38px; left: 0; z-index: 30; background: var(--surface-3); border: 1px solid var(--line-strong); padding: 10px; display: flex; flex-direction: column; gap: 8px; width: 190px; }
    .sw { display: flex; flex-wrap: wrap; gap: 6px; } .dot { width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line-strong); }
    .cp { width: 100%; height: 30px; background: transparent; border: 1px solid var(--line); cursor: pointer; }
    .hint { font-size: 12px; color: var(--gray-light); margin-left: auto; }
    .stage { padding: 28px 12px 120px; overflow-x: auto; background: var(--stage); }
    @media (max-width: 900px) { .toolbar { flex-wrap: nowrap; overflow-x: auto; } .grp { flex: none; } .hint { display: none; } .stage { padding: 10px 0 100px; } }
  `],
})
export class PagesEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  private zone = inject(NgZone);
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;
  @ViewChild('stage', { static: true }) stage!: ElementRef<HTMLElement>;
  @Input() content = '';
  @Input() editable = false;
  @Output() contentChange = new EventEmitter<string>();

  palette = PALETTE;
  pop = signal(false);
  zoom = signal(1);
  hasSel = signal(false);
  private sel: HTMLElement | null = null;
  private ro?: ResizeObserver;
  private drag: { el: HTMLElement; x: number; y: number; left: number; top: number } | null = null;
  private last = '';

  ngAfterViewInit() {
    this.load(this.content);
    const el = this.host.nativeElement;
    el.addEventListener('input', this.onInput);
    el.addEventListener('focusin', this.onFocusIn);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('paste', this.onPaste);
    el.addEventListener('pointerdown', this.onPointerDown);
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
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  // ---- rendering ----
  private load(html: string) {
    // `html` was sanitized by the API when it was saved.
    this.host.nativeElement.innerHTML = html;
    this.last = html;
    this.sel = null;
    this.hasSel.set(false);
    this.applyEditable();
    setTimeout(() => this.fit());
  }

  private applyEditable() {
    this.host.nativeElement.querySelectorAll<HTMLElement>('.tb').forEach((tb) => {
      if (this.editable) { tb.setAttribute('contenteditable', 'true'); tb.setAttribute('spellcheck', 'false'); }
      else { tb.removeAttribute('contenteditable'); tb.removeAttribute('spellcheck'); tb.classList.remove('sel'); }
    });
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
    clone.querySelectorAll('.sel').forEach((e) => e.classList.remove('sel'));
    return clone.innerHTML; // already wrapped in <div class="pdfpages">
  }

  private emit() {
    this.last = this.serialize();
    this.zone.run(() => this.contentChange.emit(this.last));
  }

  // ---- editing events ----
  private onInput = () => this.emit();

  private onFocusIn = (e: Event) => {
    const tb = (e.target as HTMLElement).closest?.('.tb') as HTMLElement | null;
    this.sel?.classList.remove('sel');
    this.sel = tb;
    tb?.classList.add('sel');
    this.zone.run(() => this.hasSel.set(!!tb));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  };

  private onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  };

  // drag by the ✥ handle (the ::before area left of the box)
  private onPointerDown = (e: PointerEvent) => {
    if (!this.editable) return;
    const tb = (e.target as HTMLElement).closest?.('.tb') as HTMLElement | null;
    if (!tb || e.offsetX >= 0 || !tb.classList.contains('sel')) return;
    e.preventDefault();
    this.drag = { el: tb, x: e.clientX, y: e.clientY, left: parseFloat(tb.style.left) || 0, top: parseFloat(tb.style.top) || 0 };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const k = PT_PER_PX / this.zoom();
    this.drag.el.style.left = `${(this.drag.left + (e.clientX - this.drag.x) * k).toFixed(2)}pt`;
    this.drag.el.style.top = `${(this.drag.top + (e.clientY - this.drag.y) * k).toFixed(2)}pt`;
  };
  private onPointerUp = () => {
    if (this.drag) { this.drag = null; this.emit(); }
  };

  // ---- toolbar ----
  cmd(name: 'bold' | 'italic' | 'underline') {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(name);
    this.emit();
  }

  color(c: string) {
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, c);
    this.pop.set(false);
    this.emit();
  }

  /** Scale the whole selected box (font sizes + line pitch) by one step. */
  resize(dir: 1 | -1) {
    if (!this.sel) return;
    const k = dir > 0 ? 1.1 : 1 / 1.1;
    const tb = this.sel;
    tb.style.lineHeight = `${((parseFloat(tb.style.lineHeight) || 12) * k).toFixed(2)}pt`;
    tb.querySelectorAll<HTMLElement>('span').forEach((s) => {
      const v = parseFloat(s.style.fontSize);
      if (v) s.style.fontSize = `${(v * k).toFixed(2)}pt`;
      const ls = parseFloat(s.style.letterSpacing);
      if (ls) s.style.letterSpacing = `${(ls * k).toFixed(2)}pt`;
    });
    this.emit();
  }

  addBox() {
    const pages = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.pdf-page'));
    if (!pages.length) return;
    // the page that is most visible
    const mid = window.innerHeight / 2;
    const page = pages.reduce((a, b) => (Math.abs(a.getBoundingClientRect().top + a.getBoundingClientRect().height / 2 - mid) < Math.abs(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2 - mid) ? a : b));
    const tb = document.createElement('div');
    tb.className = 'tb';
    tb.setAttribute("style", "left: 48pt; top: 48pt; line-height: 14pt; font-family: 'Lexend', sans-serif; font-size: 10.00pt; font-weight: 300");
    tb.innerHTML = `<span style="font-family: 'Lexend', sans-serif; font-size: 10.00pt; color: #14141a; font-weight: 300">Nuevo texto</span>`;
    page.appendChild(tb);
    this.applyEditable();
    tb.focus();
    document.getSelection()?.selectAllChildren(tb);
    this.emit();
  }

  removeBox() {
    if (!this.sel) return;
    this.sel.remove();
    this.sel = null;
    this.hasSel.set(false);
    this.emit();
  }
}
