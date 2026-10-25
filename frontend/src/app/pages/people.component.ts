import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { DirUser } from '../core/models';
import { AvatarComponent, IconComponent } from '../shared/ui';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [FormsModule, AvatarComponent, IconComponent],
  template: `
    <div class="page">
      <header class="page-head"><div><span class="eyebrow">Directorio</span><h1 class="title-xl">Personas.</h1></div>
        <div class="find"><x-icon name="search" /><input class="input" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Filtrar por nombre o cargo" aria-label="Filtrar personas"></div></header>
      <div class="grid">
        @for (u of filtered(); track u.id) {
          <div class="card person" [class.off]="!u.active">
            <x-avatar size="lg" [name]="u.name" [color]="u.color" />
            <div><h3>{{ u.name }}</h3><p class="muted">{{ u.jobTitle || '—' }}</p></div>
            <footer><a class="mail" [href]="'mailto:' + u.email">{{ u.email }}</a>@if (u.role) { <span class="chip">{{ u.role.name }}</span> }</footer>
          </div>
        } @empty { <div class="empty" style="grid-column:1/-1">Sin resultados.</div> }
      </div>
    </div>`,
  styles: [`
    .find { position: relative; width: min(320px, 100%); x-icon { position: absolute; left: 12px; top: 12px; color: var(--gray-light); width: 16px; height: 16px; } .input { padding-left: 36px; } }
    .person { padding: 24px; display: flex; flex-direction: column; gap: 16px; &.off { opacity: .5; } } h3 { font-size: 20px; letter-spacing: -.015em; } p { font-size: 14px; }
    footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 14px; border-top: 1px solid var(--line); flex-wrap: wrap; } .mail { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; &:hover { color: var(--white); } }
  `],
})
export class PeopleComponent implements OnInit {
  private api = inject(Api);
  users = signal<DirUser[]>([]);
  q = signal('');
  filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.users().filter((u) => !q || u.name.toLowerCase().includes(q) || u.jobTitle.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });
  async ngOnInit() { this.users.set(await this.api.users()); }
}
