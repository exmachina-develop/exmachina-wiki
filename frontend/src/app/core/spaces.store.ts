import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Space } from './models';

/** Sidebar-visible spaces, shared so any page can refresh them after a change. */
@Injectable({ providedIn: 'root' })
export class SpacesStore {
  private api = inject(Api);
  spaces = signal<Space[]>([]);
  async reload() {
    try { this.spaces.set(await this.api.spaces()); } catch { /* shown elsewhere */ }
  }
}
