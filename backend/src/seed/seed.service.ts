import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Department, DepartmentMember, DocumentEntity, Role, Space, SpaceMember, User } from '../entities';
import { ALL_PERMISSIONS } from '../common/permissions';

const SEED_USERS = [
  { env: 'SAMUEL', username: 'samuel.rojas', name: 'Samuel Rojas', email: 'samuel.rojas@exmachina.systems', color: '#7047FF' },
  { env: 'ALBERT', username: 'albert.fonseca', name: 'Albert Fonseca', email: 'albert.fonse@exmachina.systems', color: '#416BFF' },
  { env: 'GABRIEL', username: 'gabriel.perez', name: 'Gabriel Pérez', email: 'gabriel.perez@exmachina.systems', color: '#2BB3A3' },
  { env: 'EMANUEL', username: 'emanuel.jimenez', name: 'Emanuel Jiménez', email: 'emanuel.jimenez@exmachina.systems', color: '#E0A84A' },
];

const WELCOME = `
<h1>Bienvenido a la Wiki de EXMACHINA</h1>
<p>Este es el espacio donde vive el conocimiento de la empresa. Aquí puedes crear documentos desde cero, importar PDF para editarlos y exportarlos de nuevo conservando el formato.</p>
<h2>Primeros pasos</h2>
<ul>
<li><p>Crea un <strong>espacio de trabajo</strong> para cada equipo o proyecto.</p></li>
<li><p>Define el <strong>organigrama</strong> y asigna a los responsables de cada área.</p></li>
<li><p>Usa los <strong>roles</strong> para controlar quién puede leer, editar o administrar.</p></li>
</ul>
<table><tbody>
<tr><th><p>Función</p></th><th><p>Dónde</p></th></tr>
<tr><td><p>Importar / exportar PDF</p></td><td><p>Menú del espacio y barra del documento</p></td></tr>
<tr><td><p>Organigrama</p></td><td><p>Sección «Organigrama»</p></td></tr>
<tr><td><p>Usuarios y roles</p></td><td><p>Sección «Administración»</p></td></tr>
</tbody></table>
<p style="text-align:center"><em>El futuro no se predice. Se construye.</em></p>`;

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private log = new Logger('Seed');

  constructor(
    @InjectRepository(Role) private roles: Repository<Role>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Space) private spaces: Repository<Space>,
    @InjectRepository(SpaceMember) private members: Repository<SpaceMember>,
    @InjectRepository(Department) private deps: Repository<Department>,
    @InjectRepository(DepartmentMember) private depMembers: Repository<DepartmentMember>,
    @InjectRepository(DocumentEntity) private docs: Repository<DocumentEntity>,
  ) {}

  async onApplicationBootstrap() {
    const defs = [
      { name: 'Administrador', description: 'Acceso total a la plataforma', permissions: ALL_PERMISSIONS },
      {
        name: 'Editor',
        description: 'Crea, edita e importa/exporta documentos',
        permissions: ['documents.create', 'documents.edit', 'documents.import', 'documents.export', 'files.upload'],
      },
      { name: 'Lector', description: 'Solo lectura y exportación', permissions: ['documents.export'] },
    ];
    for (const d of defs) {
      const existing = await this.roles.findOne({ where: { name: d.name } });
      if (!existing) await this.roles.save(this.roles.create({ ...d, isSystem: true }));
      // The administrator role always carries every permission, including ones added in later releases.
      else if (d.name === 'Administrador') await this.roles.update(existing.id, { permissions: ALL_PERMISSIONS, isSystem: true });
    }
    const admin = await this.roles.findOneOrFail({ where: { name: 'Administrador' } });

    // Accounts created before usernames existed: derive one from the e-mail local part.
    for (const u of await this.users.find()) {
      if (!u.username) await this.users.update(u.id, { username: u.email.split('@')[0].toLowerCase() });
    }

    const created: User[] = [];
    for (const s of SEED_USERS) {
      if (await this.users.findOne({ where: { email: s.email } })) continue;
      const password = process.env[`SEED_PASSWORD_${s.env}`] || randomBytes(9).toString('base64url');
      if (!process.env[`SEED_PASSWORD_${s.env}`]) this.log.warn(`Credenciales generadas → ${s.email} / ${password}`);
      created.push(
        await this.users.save(this.users.create({ name: s.name, username: s.username, email: s.email, color: s.color, roleId: admin.id, passwordHash: await bcrypt.hash(password, 11) })),
      );
    }

    if ((await this.spaces.count()) === 0) {
      const all = await this.users.find();
      const space = await this.spaces.save(this.spaces.create({ key: 'EXM', name: 'EXMACHINA', description: 'Espacio general de la empresa', icon: '◆', visibility: 'company', ownerId: all[0]?.id }));
      await this.members.save(all.map((u) => this.members.create({ spaceId: space.id, userId: u.id, role: 'admin' })));
      await this.docs.save(
        this.docs.create({ spaceId: space.id, title: 'Bienvenida', icon: '◆', content: WELCOME, contentText: 'Bienvenido a la Wiki de EXMACHINA', authorId: all[0]?.id, updatedById: all[0]?.id }),
      );
    }
    if ((await this.deps.count()) === 0) {
      const all = await this.users.find();
      const root = await this.deps.save(this.deps.create({ name: 'EXMACHINA', description: 'Dirección general', color: '#7047FF' }));
      await this.depMembers.save(all.map((u) => this.depMembers.create({ departmentId: root.id, userId: u.id, isHead: false, title: 'Socio' })));
    }
    if (created.length) this.log.log(`Usuarios iniciales creados: ${created.map((u) => u.email).join(', ')}`);
  }
}
