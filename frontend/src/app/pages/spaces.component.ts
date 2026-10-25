import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth.service';
import { SpacesStore } from '../core/spaces.store';
import { IconComponent } from '../shared/ui';
import { SpaceFormComponent } from '../shared/space-form.component';

@Component({
  selector: 'app-spaces',
  standalone: true,
  imports: [RouterLink, IconComponent, SpaceFormComponent],
  template: `
    <div class="page">
      <header class="page-head">
        <div><span class="eyebrow">Espacios de trabajo</span><h1 class="title-xl">Cada equipo,<br>su conocimiento.</h1></div>
        @if (auth.can('spaces.create')) { <button class="btn" (click)="open.set(true)"><x-icon name="plus" /> Nuevo espacio</button> }
      </header>
      <div class="grid">
        @for (s of store.spaces(); track s.id) {
          <a class="card space" [routerLink]="['/spaces', s.key]">
            <div class="top"><span class="ico">{{ s.icon }}</span>
              <span class="chip" [class.violet]="s.visibility === 'private'"><x-icon [name]="s.visibility === 'private' ? 'lock' : 'globe'" />{{ s.visibility === 'private' ? 'Privado' : 'Empresa' }}</span></div>
            <h3>{{ s.name }}</h3>
            <p class="muted">{{ s.description || 'Sin descripción' }}</p>
            <footer><span class="eyebrow">{{ s.key }}</span><span class="eyebrow">{{ s.docCount }} docs · {{ s.memberCount }} miembros</span></footer>
          </a>
        } @empty { <div class="empty" style="grid-column:1/-1">No hay espacios todavía.</div> }
      </div>
    </div>
    @if (open()) { <app-space-form (closed)="open.set(false)" (saved)="created($event.key)" /> }`,
  styles: [`
    .space { padding: 28px; display: flex; flex-direction: column; gap: 12px; min-height: 220px; }
    .top { display: flex; justify-content: space-between; align-items: center; } .chip x-icon { width: 12px; height: 12px; }
    .ico { font-size: 24px; color: var(--violet); } h3 { font-size: 24px; letter-spacing: -.02em; }
    p { font-size: 14px; flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    footer { display: flex; justify-content: space-between; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
  `],
})
export class SpacesComponent implements OnInit {
  auth = inject(Auth);
  store = inject(SpacesStore);
  private router = inject(Router);
  open = signal(false);
  ngOnInit() { this.store.reload(); }
  created(key: string) { this.open.set(false); this.store.reload(); this.router.navigate(['/spaces', key]); }
}
