import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { SearchHit } from '../core/models';
import { IconComponent, relTime } from '../shared/ui';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="page">
      <header class="page-head"><div><span class="eyebrow">Búsqueda</span><h1 class="title-xl">Encuentra<br>cualquier documento.</h1></div></header>
      <form (ngSubmit)="go()" class="bar">
        <x-icon name="search" />
        <input class="input" name="q" [(ngModel)]="term" placeholder="Título o contenido…" autofocus>
        <button class="btn" type="submit">Buscar</button>
      </form>
      @if (loading()) { <div class="empty"><span class="spinner"></span></div> }
      @else if (searched() && !hits().length) { <div class="empty">Sin resultados para «{{ q() }}».</div> }
      @else {
        <div class="hits">
          @for (h of hits(); track h.id) {
            <a class="card hit" [routerLink]="['/doc', h.id]">
              <div class="meta eyebrow">{{ h.space.name }} · {{ rel(h.updatedAt) }}</div>
              <h3>{{ h.icon }} {{ h.title }}</h3>
              <p class="muted">{{ h.snippet }}</p>
            </a>
          }
        </div>
      }
    </div>`,
  styles: [`
    .bar { position: relative; display: flex; gap: 10px; margin-bottom: 32px; } .bar x-icon { position: absolute; left: 14px; top: 12px; color: var(--gray-light); } .bar .input { padding-left: 42px; height: 44px; font-size: 16px; } .bar .btn { height: 44px; }
    .hits { display: flex; flex-direction: column; gap: 12px; } .hit { padding: 20px 24px; display: block; } .hit h3 { font-size: 20px; margin: 8px 0; } .hit p { font-size: 14px; }
  `],
})
export class SearchComponent {
  private api = inject(Api);
  private router = inject(Router);
  q = input('');
  term = '';
  hits = signal<SearchHit[]>([]);
  loading = signal(false);
  searched = signal(false);
  rel = relTime;

  constructor() {
    effect(() => {
      const q = this.q();
      this.term = q;
      if (q.trim().length >= 2) this.run(q);
      else { this.hits.set([]); this.searched.set(false); }
    }, { allowSignalWrites: true });
  }
  go() { this.router.navigate(['/search'], { queryParams: { q: this.term.trim() } }); }
  private async run(q: string) {
    this.loading.set(true);
    try { this.hits.set(await this.api.search(q)); this.searched.set(true); } finally { this.loading.set(false); }
  }
}
