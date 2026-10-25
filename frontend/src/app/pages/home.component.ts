import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { DocBrief } from '../core/models';
import { SpacesStore } from '../core/spaces.store';
import { AvatarComponent, IconComponent, relTime } from '../shared/ui';
import { SpaceFormComponent } from '../shared/space-form.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, IconComponent, AvatarComponent, SpaceFormComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <span class="eyebrow">{{ today }}</span>
          <h1 class="title-xl">{{ greeting }},<br>{{ firstName }}.</h1>
        </div>
        <div class="actions">
          @if (auth.can('spaces.create')) { <button class="btn ghost" (click)="newSpace.set(true)"><x-icon name="plus" /> Nuevo espacio</button> }
          <a routerLink="/search" class="btn"><x-icon name="search" /> Buscar</a>
        </div>
      </header>

      <section>
        <div class="sec-head"><span class="eyebrow">Espacios de trabajo</span><a routerLink="/spaces" class="link">Ver todos <x-icon name="arrowUR" /></a></div>
        <div class="grid">
          @for (s of store.spaces().slice(0, 6); track s.id) {
            <a class="card space" [routerLink]="['/spaces', s.key]">
              <span class="ico">{{ s.icon }}</span>
              <h3>{{ s.name }}</h3>
              <p class="muted">{{ s.description || 'Sin descripción' }}</p>
              <footer><span class="eyebrow">{{ s.key }}</span><span class="eyebrow">{{ s.docCount }} docs</span></footer>
            </a>
          } @empty { <div class="empty" style="grid-column:1/-1">Todavía no hay espacios. Crea el primero para empezar a documentar.</div> }
        </div>
      </section>

      <section style="margin-top:64px">
        <div class="sec-head"><span class="eyebrow">Actualizado recientemente</span></div>
        @if (loading()) { <div class="empty"><span class="spinner"></span></div> }
        @else if (!recent().length) { <div class="empty">Aún no hay documentos.</div> }
        @else {
          <div class="list">
            @for (d of recent(); track d.id) {
              <a class="row" [routerLink]="['/doc', d.id]">
                <span class="ico"><x-icon [name]="d.source === 'pdf' ? 'pdf' : 'file'" /></span>
                <span class="t"><b>{{ d.icon }} {{ d.title }}</b><small>{{ d.space?.name }}</small></span>
                <span class="who">@if (d.updatedBy) { <x-avatar size="sm" [name]="d.updatedBy.name" [color]="d.updatedBy.color" /> <span>{{ d.updatedBy.name }}</span> }</span>
                <span class="when eyebrow">{{ rel(d.updatedAt) }}</span>
              </a>
            }
          </div>
        }
      </section>
    </div>
    @if (newSpace()) { <app-space-form (closed)="newSpace.set(false)" (saved)="created($event.key)" /> }`,
  styles: [`
    .sec-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .link { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); &:hover { color: var(--white); } x-icon { width: 14px; height: 14px; } }
    .space { padding: 28px; display: flex; flex-direction: column; gap: 10px; min-height: 190px; }
    .space .ico { font-size: 22px; color: var(--violet); } .space h3 { font-size: 22px; letter-spacing: -.02em; } .space p { font-size: 14px; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .space footer { display: flex; justify-content: space-between; padding-top: 14px; border-top: 1px solid var(--line); }
    .list { border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
    .row { display: grid; grid-template-columns: 28px 1fr 200px 110px; gap: 16px; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--line); transition: background .2s; &:last-child { border-bottom: 0; } &:hover { background: var(--surface-2); } }
    .row .ico { color: var(--gray-light); } .t { display: flex; flex-direction: column; min-width: 0; } .t b { font-weight: 400; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .t small { color: var(--gray-light); font-size: 12px; }
    .who { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); min-width: 0; } .when { text-align: right; }
    @media (max-width: 760px) { .row { grid-template-columns: 24px 1fr; } .who, .when { display: none; } }
  `],
})
export class HomeComponent implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  auth = inject(Auth);
  store = inject(SpacesStore);
  recent = signal<DocBrief[]>([]);
  loading = signal(true);
  newSpace = signal(false);
  rel = relTime;
  today = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  get firstName() { return (this.auth.user()?.name ?? '').split(' ')[0]; }
  get greeting() { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; }

  async ngOnInit() {
    this.store.reload();
    try { this.recent.set(await this.api.recent()); } finally { this.loading.set(false); }
  }
  created(key: string) { this.newSpace.set(false); this.store.reload(); this.router.navigate(['/spaces', key]); }
}
