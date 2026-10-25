import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '../entities';
import { ALL_PERMISSIONS, AuthUser, CurrentUser, PERMISSION_CATALOG, RequirePermissions } from '../common/permissions';

const COLORS = ['#7047FF', '#416BFF', '#2BB3A3', '#E0A84A', '#E0587A', '#8B8FA3'];

class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(100) password: string;
  @IsUUID() roleId: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(100) password?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
class RoleDto {
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) permissions: string[];
}

const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  jobTitle: u.jobTitle,
  color: u.color,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  role: u.role ? { id: u.role.id, name: u.role.name } : null,
});

@Injectable()
export class IamService {
  constructor(@InjectRepository(User) public users: Repository<User>, @InjectRepository(Role) public roles: Repository<Role>) {}

  async listUsers() {
    return (await this.users.find({ order: { name: 'ASC' } })).map(publicUser);
  }

  async createUser(dto: CreateUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.findOne({ where: { email } })) throw new ConflictException('Ya existe un usuario con ese correo');
    if (!(await this.roles.findOne({ where: { id: dto.roleId } }))) throw new BadRequestException('Rol inválido');
    const count = await this.users.count();
    const u = await this.users.save(
      this.users.create({
        name: dto.name.trim(),
        email,
        roleId: dto.roleId,
        jobTitle: dto.jobTitle ?? '',
        color: COLORS[count % COLORS.length],
        passwordHash: await bcrypt.hash(dto.password, 11),
      }),
    );
    return publicUser(await this.users.findOneOrFail({ where: { id: u.id } }));
  }

  async updateUser(me: AuthUser, id: string, dto: UpdateUserDto) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) throw new NotFoundException();
    if (id === me.id && (dto.active === false || (dto.roleId && dto.roleId !== u.roleId)))
      throw new BadRequestException('No puedes desactivarte ni cambiar tu propio rol');
    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      const dup = await this.users.findOne({ where: { email } });
      if (dup && dup.id !== id) throw new ConflictException('Ya existe un usuario con ese correo');
      u.email = email;
    }
    if (dto.name) u.name = dto.name.trim();
    if (dto.jobTitle !== undefined) u.jobTitle = dto.jobTitle;
    if (dto.active !== undefined) u.active = dto.active;
    if (dto.roleId) {
      if (!(await this.roles.findOne({ where: { id: dto.roleId } }))) throw new BadRequestException('Rol inválido');
      u.roleId = dto.roleId;
    }
    if (dto.password) u.passwordHash = await bcrypt.hash(dto.password, 11);
    await this.users.save(u);
    return publicUser(await this.users.findOneOrFail({ where: { id } }));
  }

  async deleteUser(me: AuthUser, id: string) {
    if (id === me.id) throw new BadRequestException('No puedes eliminar tu propio usuario');
    await this.users.delete(id);
    return { ok: true };
  }

  async listRoles() {
    const roles = await this.roles.find({ order: { name: 'ASC' } });
    const counts = await this.users
      .createQueryBuilder('u')
      .select('u.roleId', 'roleId')
      .addSelect('COUNT(*)', 'n')
      .groupBy('u.roleId')
      .getRawMany<{ roleId: string; n: string }>();
    return roles.map((r) => ({ ...r, users: Number(counts.find((c) => c.roleId === r.id)?.n ?? 0) }));
  }

  async saveRole(id: string | null, dto: RoleDto) {
    const dup = await this.roles.findOne({ where: { name: dto.name.trim() } });
    if (dup && dup.id !== id) throw new ConflictException('Ya existe un rol con ese nombre');
    if (id) {
      const r = await this.roles.findOne({ where: { id } });
      if (!r) throw new NotFoundException();
      if (r.isSystem && r.name === 'Administrador') throw new BadRequestException('El rol Administrador no se puede modificar');
      Object.assign(r, { name: dto.name.trim(), description: dto.description ?? '', permissions: dto.permissions });
      return this.roles.save(r);
    }
    return this.roles.save(this.roles.create({ name: dto.name.trim(), description: dto.description ?? '', permissions: dto.permissions }));
  }

  async deleteRole(id: string) {
    const r = await this.roles.findOne({ where: { id } });
    if (!r) throw new NotFoundException();
    if (r.isSystem) throw new BadRequestException('Los roles del sistema no se pueden eliminar');
    if (await this.users.count({ where: { roleId: id } })) throw new BadRequestException('Hay usuarios asignados a este rol');
    await this.roles.delete(id);
    return { ok: true };
  }
}

@Controller('users')
export class UsersController {
  constructor(private iam: IamService) {}
  @Get() list() {
    return this.iam.listUsers();
  }
  @Post() @RequirePermissions('users.manage') create(@Body() dto: CreateUserDto) {
    return this.iam.createUser(dto);
  }
  @Patch(':id') @RequirePermissions('users.manage') update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.iam.updateUser(me, id, dto);
  }
  @Delete(':id') @RequirePermissions('users.manage') remove(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.iam.deleteUser(me, id);
  }
}

@Controller('roles')
export class RolesController {
  constructor(private iam: IamService) {}
  @Get() list() {
    return this.iam.listRoles();
  }
  @Get('catalog') catalog() {
    return PERMISSION_CATALOG;
  }
  @Post() @RequirePermissions('roles.manage') create(@Body() dto: RoleDto) {
    return this.iam.saveRole(null, dto);
  }
  @Patch(':id') @RequirePermissions('roles.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.iam.saveRole(id, dto);
  }
  @Delete(':id') @RequirePermissions('roles.manage') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.iam.deleteRole(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([User, Role])],
  controllers: [UsersController, RolesController],
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}
