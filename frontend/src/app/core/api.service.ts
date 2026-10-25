import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DirUser, Department, Doc, DocBrief, DocVersion, PageSettings, PermissionDef, Profile, Role, SearchHit, Space, SpaceMemberView } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private b = '/api';

  // auth
  login = (username: string, password: string) => firstValueFrom(this.http.post<{ token: string; user: Profile }>(`${this.b}/auth/login`, { username, password }));
  me = () => firstValueFrom(this.http.get<Profile>(`${this.b}/auth/me`));
  updateProfile = (d: { name?: string; jobTitle?: string }) => firstValueFrom(this.http.patch<Profile>(`${this.b}/auth/me`, d));
  changePassword = (current: string, next: string) => firstValueFrom(this.http.post(`${this.b}/auth/change-password`, { current, next }));

  // users & roles
  users = () => firstValueFrom(this.http.get<DirUser[]>(`${this.b}/users`));
  createUser = (d: object) => firstValueFrom(this.http.post<DirUser>(`${this.b}/users`, d));
  updateUser = (id: string, d: object) => firstValueFrom(this.http.patch<DirUser>(`${this.b}/users/${id}`, d));
  deleteUser = (id: string) => firstValueFrom(this.http.delete(`${this.b}/users/${id}`));
  roles = () => firstValueFrom(this.http.get<Role[]>(`${this.b}/roles`));
  permissionCatalog = () => firstValueFrom(this.http.get<PermissionDef[]>(`${this.b}/roles/catalog`));
  saveRole = (id: string | null, d: object) => firstValueFrom(id ? this.http.patch<Role>(`${this.b}/roles/${id}`, d) : this.http.post<Role>(`${this.b}/roles`, d));
  deleteRole = (id: string) => firstValueFrom(this.http.delete(`${this.b}/roles/${id}`));

  // spaces
  spaces = () => firstValueFrom(this.http.get<Space[]>(`${this.b}/spaces`));
  space = (idOrKey: string) => firstValueFrom(this.http.get<Space>(`${this.b}/spaces/${idOrKey}`));
  createSpace = (d: object) => firstValueFrom(this.http.post<Space>(`${this.b}/spaces`, d));
  updateSpace = (id: string, d: object) => firstValueFrom(this.http.patch<Space>(`${this.b}/spaces/${id}`, d));
  deleteSpace = (id: string) => firstValueFrom(this.http.delete(`${this.b}/spaces/${id}`));
  setSpaceMembers = (id: string, members: Pick<SpaceMemberView, 'userId' | 'role'>[]) => firstValueFrom(this.http.put<Space>(`${this.b}/spaces/${id}/members`, { members }));

  // documents
  docs = (spaceId: string) => firstValueFrom(this.http.get<DocBrief[]>(`${this.b}/documents`, { params: { spaceId } }));
  recent = () => firstValueFrom(this.http.get<DocBrief[]>(`${this.b}/documents/recent`));
  search = (q: string) => firstValueFrom(this.http.get<SearchHit[]>(`${this.b}/documents/search`, { params: { q } }));
  doc = (id: string) => firstValueFrom(this.http.get<Doc>(`${this.b}/documents/${id}`));
  createDoc = (d: { spaceId: string; parentId?: string | null; title?: string; content?: string }) => firstValueFrom(this.http.post<Doc>(`${this.b}/documents`, d));
  saveDoc = (id: string, d: { title?: string; content?: string; icon?: string; parentId?: string | null; pageSettings?: PageSettings; snapshot?: boolean; note?: string }) =>
    firstValueFrom(this.http.patch<Doc>(`${this.b}/documents/${id}`, d));
  deleteDoc = (id: string) => firstValueFrom(this.http.delete(`${this.b}/documents/${id}`));
  versions = (id: string) => firstValueFrom(this.http.get<DocVersion[]>(`${this.b}/documents/${id}/versions`));
  version = (id: string, vid: string) => firstValueFrom(this.http.get<DocVersion>(`${this.b}/documents/${id}/versions/${vid}`));
  restore = (id: string, vid: string) => firstValueFrom(this.http.post<Doc>(`${this.b}/documents/${id}/versions/${vid}/restore`, {}));
  importPdf = (file: File, spaceId: string, parentId?: string | null) => {
    const f = new FormData();
    f.append('spaceId', spaceId);
    if (parentId) f.append('parentId', parentId);
    f.append('file', file);
    return firstValueFrom(this.http.post<{ document: Doc; warnings: string[]; pages: number }>(`${this.b}/documents/import`, f));
  };
  exportPdf = (id: string) => firstValueFrom(this.http.get(`${this.b}/documents/${id}/export/pdf`, { responseType: 'blob' }));
  fileBlob = (id: string) => firstValueFrom(this.http.get(`${this.b}/files/${id}/raw`, { responseType: 'blob' }));
  addAttachment = (id: string, file: File) => {
    const f = new FormData();
    f.append('file', file);
    return firstValueFrom(this.http.post<Doc>(`${this.b}/documents/${id}/attachments`, f));
  };
  removeAttachment = (id: string, fileId: string) => firstValueFrom(this.http.delete<Doc>(`${this.b}/documents/${id}/attachments/${fileId}`));
  uploadImage = (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return firstValueFrom(this.http.post<{ id: string; url: string }>(`${this.b}/files`, f));
  };

  // org
  org = () => firstValueFrom(this.http.get<Department[]>(`${this.b}/org`));
  createDept = (d: object) => firstValueFrom(this.http.post<Department>(`${this.b}/org`, d));
  updateDept = (id: string, d: object) => firstValueFrom(this.http.patch<Department>(`${this.b}/org/${id}`, d));
  deleteDept = (id: string) => firstValueFrom(this.http.delete(`${this.b}/org/${id}`));
  setDeptMembers = (id: string, members: { userId: string; isHead: boolean; title?: string }[]) => firstValueFrom(this.http.put<Department[]>(`${this.b}/org/${id}/members`, { members }));
}
