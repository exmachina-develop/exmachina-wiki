import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="login">
      <header><img src="img/logo.png" alt="EXMACHINA®" class="logo"></header>

      <section class="hero">
        <span class="eyebrow">Wiki · Conocimiento interno</span>
        <h1 class="title-xl">El conocimiento<br>se construye.</h1>
        <p class="muted lead">Documentos, espacios de trabajo y organigrama de EXMACHINA en un único lugar.</p>
      </section>

      <form class="panel" (ngSubmit)="submit()" autocomplete="on">
        <span class="eyebrow">Acceso</span>
        <div class="field">
          <label for="email">Correo</label>
          <input id="email" name="email" class="input" type="email" autocomplete="username" required [(ngModel)]="email" placeholder="nombre@exmachina.systems">
        </div>
        <div class="field">
          <label for="pw">Contraseña</label>
          <input id="pw" name="password" class="input" type="password" autocomplete="current-password" required [(ngModel)]="password" placeholder="••••••••">
        </div>
        @if (error()) { <p class="error-text">{{ error() }}</p> }
        <button class="btn" type="submit" [disabled]="busy() || !email || !password">
          @if (busy()) { <span class="spinner"></span> } @else { Entrar }
        </button>
      </form>

      <footer class="eyebrow">© EXMACHINA®</footer>
    </main>`,
  styles: [`
    .login { min-height: 100dvh; display: grid; grid-template-columns: 1.2fr 1fr; grid-template-rows: auto 1fr auto; padding: 32px 48px; column-gap: 64px;
      background: radial-gradient(800px 500px at 15% 90%, rgba(112,71,255,.14), transparent 60%), radial-gradient(600px 400px at 90% 10%, rgba(65,107,255,.10), transparent 60%), var(--black); }
    header { grid-column: 1 / -1; } .logo { height: 17px; width: auto; }
    .hero { align-self: end; padding-bottom: 8vh; grid-row: 2; } .hero .eyebrow { display: block; margin-bottom: 24px; }
    .lead { max-width: 420px; margin-top: 28px; font-size: 18px; line-height: 1.45; }
    .panel { grid-row: 2; align-self: center; width: 100%; max-width: 420px; justify-self: end; padding: 36px; border: 1px solid var(--line); background: rgba(10,10,16,.7); backdrop-filter: blur(10px); }
    .panel .eyebrow { display: block; margin-bottom: 28px; } .panel .btn { width: 100%; height: 44px; margin-top: 8px; }
    footer { grid-column: 1 / -1; padding-top: 24px; }
    @media (max-width: 900px) { .login { grid-template-columns: 1fr; padding: 24px 20px; } .hero { grid-row: 2; align-self: start; padding: 8vh 0 32px; } .panel { grid-row: 3; justify-self: stretch; max-width: none; padding: 24px 20px; } footer { grid-row: 4; } }
  `],
})
export class LoginComponent {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  email = '';
  password = '';
  busy = signal(false);
  error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email, this.password);
      const next = this.route.snapshot.queryParamMap.get('next');
      await this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (e: any) {
      this.error.set(e?.status === 429 ? 'Demasiados intentos. Espera un minuto.' : e?.error?.message || 'No se pudo iniciar sesión');
    } finally {
      this.busy.set(false);
    }
  }
}
