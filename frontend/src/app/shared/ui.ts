import { Component, Input, ChangeDetectionStrategy, EventEmitter, Output, HostListener } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

// Minimal stroke icon set (24x24, 1.5px stroke).
const P: Record<string, string> = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  spaces: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  org: '<rect x="9" y="3" width="6" height="5"/><rect x="2" y="16" width="6" height="5"/><rect x="16" y="16" width="6" height="5"/><path d="M12 8v4M5 16v-4h14v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.3c2 .8 3.5 2.800 3.500 5.700"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  menu: '<path d="M4 8h16M4 16h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  bold: '<path d="M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  underline: '<path d="M7 4v7a5 5 0 0010 0V4M5 21h14"/>',
  strike: '<path d="M4 12h16M16 6.500C15 5 13.500 4.500 12 4.500c-2.500 0-4 1.200-4 3 0 1.500 1 2.300 4 3M8 17.500C9 19 10.500 19.500 12 19.500c2.500 0 4-1.200 4-3"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  alignJustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  listUl: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.500" cy="6" r=".8"/><circle cx="4.500" cy="12" r=".8"/><circle cx="4.500" cy="18" r=".8"/>',
  listOl: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.500-1v4M3.500 13.500c.5-1 2.500-1 2.500.5s-2.500 2-2.500 3H6"/>',
  table: '<rect x="3" y="4" width="18" height="16"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  image: '<rect x="3" y="4" width="18" height="16"/><circle cx="9" cy="10" r="1.800"/><path d="M3 18l6-5 4 3 3-3 5 4"/>',
  link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 12"/>',
  quote: '<path d="M5 17V11a4 4 0 014-4M13 17V11a4 4 0 014-4"/><path d="M5 17h4v-4H5zM13 17h4v-4h-4z"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.500M3 4v5h5M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  chevronR: '<path d="M9 6l6 6-6 6"/>',
  chevronD: '<path d="M6 9l6 6 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.200 4.200l2.100 2.100M17.700 17.700l2.100 2.100M2 12h3M19 12h3M4.200 19.800l2.100-2.100M17.700 6.300l2.100-2.100"/>',
  logout: '<path d="M10 4H4v16h6M16 8l4 4-4 4M20 12H9"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  highlight: '<path d="M4 20h6M14 4l6 6-9 9-6-6zM8 12l4 4"/>',
  arrowUR: '<path d="M7 17L17 7M8 7h9v9"/>',
  hr: '<path d="M3 12h18"/><path d="M8 7h8M8 17h8" opacity=".4"/>',
  sub: '<path d="M4 6l8 10M12 6L4 16M17 20h4c0-2-4-2-4-4a2 2 0 014 0" />',
  sup: '<path d="M4 8l8 10M12 8L4 18M17 8h4c0-2-4-2-4-4a2 2 0 014 0" />',
  indent: '<path d="M4 6h16M12 10h8M12 14h8M4 18h16M4 9l3 3-3 3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  rowAdd: '<rect x="3" y="4" width="18" height="10"/><path d="M3 9h18M12 17v4M10 19h4"/>',
  colAdd: '<rect x="4" y="3" width="10" height="18"/><path d="M9 3v18M17 10v4M15 12h4"/>',
  merge: '<rect x="3" y="5" width="18" height="14"/><path d="M12 5v4M12 15v4M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2"/>',
  file2: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  pdf: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M8.500 17v-4h1.500a1.200 1.200 0 010 2.400H8.500M13 17v-4h1a2 2 0 012 2v0a2 2 0 01-2 2z" stroke-width="1.200"/>',
};

@Component({
  selector: 'x-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [innerHTML]="svg"></svg>`,
  styles: [`:host{display:inline-flex;width:18px;height:18px;flex:none}svg{width:100%;height:100%}`],
})
export class IconComponent {
  private s = inject(DomSanitizer);
  svg: SafeHtml = '';
  @Input() set name(n: string) { this.svg = this.s.bypassSecurityTrustHtml(P[n] ?? ''); }
}

@Component({
  selector: 'x-avatar',
  standalone: true,
  template: `<span class="avatar" [class.sm]="size === 'sm'" [class.lg]="size === 'lg'" [style.background]="color || '#7047FF'" [title]="name">{{ initials }}</span>`,
})
export class AvatarComponent {
  @Input() name = '';
  @Input() color = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  get initials() { return this.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
}

@Component({
  selector: 'x-modal',
  standalone: true,
  template: `
    <div class="overlay" (mousedown)="onBackdrop($event)">
      <div class="modal" [class.wide]="wide" role="dialog" aria-modal="true" (mousedown)="$event.stopPropagation()">
        <ng-content />
      </div>
    </div>`,
})
export class ModalComponent {
  @Input() wide = false;
  @Output() closed = new EventEmitter<void>();
  onBackdrop(_e: MouseEvent) { this.closed.emit(); }
  @HostListener('document:keydown.escape') esc() { this.closed.emit(); }
}

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
