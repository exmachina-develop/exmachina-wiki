import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const PERMISSION_CATALOG = [
  { key: 'documents.create', group: 'Documentos', label: 'Crear documentos' },
  { key: 'documents.edit', group: 'Documentos', label: 'Editar documentos' },
  { key: 'documents.delete', group: 'Documentos', label: 'Eliminar documentos' },
  { key: 'documents.import', group: 'Documentos', label: 'Importar PDF' },
  { key: 'documents.export', group: 'Documentos', label: 'Exportar a PDF' },
  { key: 'files.upload', group: 'Archivos', label: 'Subir archivos e imágenes' },
  { key: 'spaces.create', group: 'Espacios', label: 'Crear espacios de trabajo' },
  { key: 'spaces.manage', group: 'Espacios', label: 'Administrar cualquier espacio' },
  { key: 'org.manage', group: 'Organigrama', label: 'Gestionar organigrama y responsables' },
  { key: 'users.manage', group: 'Administración', label: 'Gestionar usuarios' },
  { key: 'roles.manage', group: 'Administración', label: 'Gestionar roles y permisos' },
] as const;

export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.map((p) => p.key);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roleName: string;
  permissions: string[];
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS_KEY = 'perms';
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const can = (u: AuthUser, perm: string) => u.permissions.includes(perm);
