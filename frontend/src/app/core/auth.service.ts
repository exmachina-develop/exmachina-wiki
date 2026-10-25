import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Api } from './api.service';
import { Profile } from './models';

const TOKEN_KEY = 'exm_token';
const read = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private router = inject(Router);
  token = signal<string | null>(read());
  user = signal<Profile | null>(null);
  permissions = computed(() => new Set(this.user()?.permissions ?? []));
  can = (p: string) => this.permissions().has(p);
  isAdmin = computed(() => this.can('users.manage') || this.can('roles.manage'));

  async login(email: string, password: string) {
    const r = await this.api.login(email, password);
    this.setToken(r.token);
    this.user.set(r.user);
  }

  async restore(): Promise<boolean> {
    if (!this.token()) return false;
    if (this.user()) return true;
    try {
      this.user.set(await this.api.me());
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  logout() {
    this.clear();
    this.router.navigateByUrl('/login');
  }

  private setToken(t: string) {
    this.token.set(t);
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ }
  }
  clear() {
    this.token.set(null);
    this.user.set(null);
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const t = auth.token();
  const authed = t && req.url.startsWith('/api') ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req;
  return next(authed).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.endsWith('/auth/login')) auth.logout();
      return throwError(() => e);
    }),
  );
};

export const authGuard: CanActivateFn = async (_r, state) => {
  const auth = inject(Auth);
  if (await auth.restore()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const permGuard = (perm: string): CanActivateFn => () => inject(Auth).can(perm) || inject(Router).createUrlTree(['/']);
export const adminGuard: CanActivateFn = () => inject(Auth).isAdmin() || inject(Router).createUrlTree(['/']);
