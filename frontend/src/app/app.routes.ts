import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core/auth.service';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login.component').then((m) => m.LoginComponent), title: 'Acceder · EXMACHINA Wiki' },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/home.component').then((m) => m.HomeComponent), title: 'Inicio · EXMACHINA Wiki' },
      { path: 'spaces', loadComponent: () => import('./pages/spaces.component').then((m) => m.SpacesComponent), title: 'Espacios · EXMACHINA Wiki' },
      { path: 'spaces/:key', loadComponent: () => import('./pages/space.component').then((m) => m.SpaceComponent) },
      { path: 'doc/:id', loadComponent: () => import('./pages/doc.component').then((m) => m.DocComponent) },
      { path: 'search', loadComponent: () => import('./pages/search.component').then((m) => m.SearchComponent), title: 'Buscar · EXMACHINA Wiki' },
      { path: 'org', loadComponent: () => import('./pages/org.component').then((m) => m.OrgComponent), title: 'Organigrama · EXMACHINA Wiki' },
      { path: 'people', loadComponent: () => import('./pages/people.component').then((m) => m.PeopleComponent), title: 'Personas · EXMACHINA Wiki' },
      { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./pages/admin.component').then((m) => m.AdminComponent), title: 'Administración · EXMACHINA Wiki' },
      { path: 'profile', loadComponent: () => import('./pages/profile.component').then((m) => m.ProfileComponent), title: 'Mi perfil · EXMACHINA Wiki' },
    ],
  },
  { path: '**', redirectTo: '' },
];
