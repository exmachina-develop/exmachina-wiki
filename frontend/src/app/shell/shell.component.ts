import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs';
import { Auth } from '../core/auth.service';
import { SpacesStore } from '../core/spaces.store';
import { AvatarComponent, IconComponent } from '../shared/ui';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, IconComponent, AvatarComponent],
  template: `
    <header class="topbar">
      <button class="btn subtle icon" (click)="open.set(true)" aria-label="Abrir menú"><x-icon name="menu" /></button>
      <a routerLink="/" class="brand"><img src="img/logo.png" alt="EXMACHINA®"></a>
      <a routerLink="/search" class="btn subtle icon" aria-label="Buscar"><x-icon name="search" /></a>
    </header>

    @if (open()) { <div class="scrim" (click)="open.set(false)"></div> }

    <aside class="sidebar" [class.open]="open()">
      <a routerLink="/" class="brand desktop-brand"><img src="img/logo.png" alt="EXMACHINA®"><span class="eyebrow">Wiki</span></a>

      <form class="search" (ngSubmit)="search()">
        <x-icon name="search" />
        <input name="q" [(ngModel)]="q" placeholder="Buscar en la wiki" aria-label="Buscar en la wiki">
      </form>

      <nav>
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><x-icon name="home" /> Inicio</a>
        <a routerLink="/spaces" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><x-icon name="spaces" /> Espacios</a>
        <a routerLink="/org" routerLinkActive="active"><x-icon name="org" /> Organigrama</a>
        <a routerLink="/people" routerLinkActive="active"><x-icon name="users" /> Personas</a>
        @if (auth.isAdmin()) { <a routerLink="/admin" routerLinkActive="active"><x-icon name="shield" /> Administración</a> }
      </nav>

      <div class="group">
        <span class="eyebrow">Espacios</span>
        <div class="spaces">
          @for (s of store.spaces(); track s.id) {
            <a [routerLink]="['/spaces', s.key]" routerLinkActive="active">
              <span class="ico">{{ s.icon }}</span><span class="nm">{{ s.name }}</span>
              @if (s.visibility === 'private') { <x-icon name="lock" /> }
            </a>
          }
        </div>
      </div>

      <div class="me">
        <a routerLink="/profile" class="who">
          <x-avatar [name]="auth.user()?.name ?? ''" [color]="auth.user()?.color ?? ''" />
          <span><b>{{ auth.user()?.name }}</b><small>{{ auth.user()?.role?.name }}</small></span>
        </a>
        <button class="btn subtle icon sm" (click)="auth.logout()" aria-label="Cerrar sesión" title="Cerrar sesión"><x-icon name="logout" /></button>
      </div>
    </aside>

    <main class="content"><router-outlet /></main>`,
  styles: [`
    :host { display: block; }
    .topbar { display: none; position: sticky; top: 0; z-index: 40; height: var(--topbar-h); align-items: center; justify-content: space-between; padding: 0 12px; background: rgba(5,5,9,.88); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .brand img { height: 15px; width: auto; }
    .scrim { position: fixed; inset: 0; background: rgba(2,2,6,.7); z-index: 49; animation: fade .2s; }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: var(--sidebar-w); z-index: 50; background: var(--black); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 24px 16px 16px; gap: 22px; overflow-y: auto; }
    .desktop-brand { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 0; }
    .search { position: relative; display: flex; align-items: center; }
    .search x-icon { position: absolute; left: 12px; color: var(--gray-light); width: 16px; height: 16px; }
    .search input { width: 100%; height: 38px; padding: 0 12px 0 36px; background: var(--surface); border: 1px solid var(--line); border-radius: 2px; font-size: 14px; &:focus { outline: none; border-color: var(--violet); } &::placeholder { color: var(--gray); } }
    nav { display: flex; flex-direction: column; gap: 2px; }
    nav a, .spaces a { display: flex; align-items: center; gap: 12px; height: 38px; padding: 0 12px; border-radius: 2px; font-size: 14px; color: var(--muted); transition: color .2s, background .2s; }
    nav a:hover, .spaces a:hover { color: var(--white); background: rgba(244,244,247,.05); }
    nav a.active, .spaces a.active { color: var(--white); background: rgba(112,71,255,.14); box-shadow: inset 2px 0 0 var(--violet); }
    .group { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; } .group .eyebrow { padding: 0 12px; }
    .spaces { display: flex; flex-direction: column; gap: 2px; } .spaces .ico { width: 18px; text-align: center; color: var(--violet); } .spaces .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .spaces x-icon { width: 13px; height: 13px; color: var(--gray); }
    .me { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 14px; border-top: 1px solid var(--line); }
    .who { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 4px 6px; border-radius: 2px; &:hover { background: rgba(244,244,247,.05); } }
    .who span { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; } .who b { font-weight: 400; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .who small { font-size: 12px; color: var(--gray-light); }
    .content { margin-left: var(--sidebar-w); min-height: 100vh; }
    @media (max-width: 900px) {
      .topbar { display: flex; }
      .sidebar { transform: translateX(-100%); transition: transform .35s var(--ease); width: min(300px, 86vw); padding-top: max(24px, env(safe-area-inset-top)); }
      .sidebar.open { transform: none; }
      .content { margin-left: 0; min-height: calc(100vh - var(--topbar-h)); }
    }
  `],
})
export class ShellComponent implements OnInit {
  auth = inject(Auth);
  store = inject(SpacesStore);
  private router = inject(Router);
  open = signal(false);
  q = '';

  ngOnInit() {
    this.store.reload();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.open.set(false));
  }

  search() {
    if (this.q.trim().length) this.router.navigate(['/search'], { queryParams: { q: this.q.trim() } });
  }

  @HostListener('document:keydown', ['$event'])
  hotkey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      (document.querySelector('.search input') as HTMLInputElement | null)?.focus();
    }
  }
}
