import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Repository } from 'typeorm';
import { DocumentEntity, Space, SpaceMember, SpaceRole, SpaceVisibility, User } from '../entities';
import { AuthUser, CurrentUser, RequirePermissions, can } from '../common/permissions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class MemberDto {
  @IsUUID() userId: string;
  @IsIn(['admin', 'editor', 'viewer']) role: SpaceRole;
}
class SpaceDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{2,12}$/) key?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsIn(['company', 'private']) visibility?: SpaceVisibility;
}
class UpdateSpaceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsIn(['company', 'private']) visibility?: SpaceVisibility;
}
class MembersDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => MemberDto) members: MemberDto[];
}

export interface SpaceAccess {
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
}

@Injectable()
export class AccessService {
  constructor(@InjectRepository(Space) private spaces: Repository<Space>, @InjectRepository(SpaceMember) private members: Repository<SpaceMember>) {}

  async resolve(idOrKey: string): Promise<Space> {
    const space = await this.spaces.findOne({ where: UUID_RE.test(idOrKey) ? { id: idOrKey } : { key: idOrKey.toUpperCase() } });
    if (!space) throw new NotFoundException('Espacio no encontrado');
    return space;
  }

  async access(user: AuthUser, space: Space): Promise<SpaceAccess> {
    const manage = can(user, 'spaces.manage');
    const m = await this.members.findOne({ where: { spaceId: space.id, userId: user.id } });
    const canView = manage || space.visibility === 'company' || !!m;
    const canEdit = canView && (manage || (can(user, 'documents.edit') && (space.visibility === 'company' ? m?.role !== 'viewer' : !!m && m.role !== 'viewer')));
    return { canView, canEdit, canManage: manage || m?.role === 'admin' };
  }

  async requireView(user: AuthUser, space: Space) {
    const a = await this.access(user, space);
    if (!a.canView) throw new ForbiddenException('No tienes acceso a este espacio');
    return a;
  }

  async requireEdit(user: AuthUser, space: Space) {
    const a = await this.access(user, space);
    if (!a.canEdit) throw new ForbiddenException('No tienes permiso de edición en este espacio');
    return a;
  }

  /** Ids of all spaces the user can view. */
  async visibleSpaceIds(user: AuthUser): Promise<string[]> {
    if (can(user, 'spaces.manage')) return (await this.spaces.find({ select: ['id'] })).map((s) => s.id);
    const company = await this.spaces.find({ where: { visibility: 'company' }, select: ['id'] });
    const mine = await this.members.find({ where: { userId: user.id } });
    return [...new Set([...company.map((s) => s.id), ...mine.map((m) => m.spaceId)])];
  }
}

const memberView = (m: SpaceMember) => ({ userId: m.userId, role: m.role, name: m.user?.name, email: m.user?.email, color: m.user?.color });

@Injectable()
export class SpacesService {
  constructor(
    private access: AccessService,
    @InjectRepository(Space) private spaces: Repository<Space>,
    @InjectRepository(SpaceMember) private members: Repository<SpaceMember>,
    @InjectRepository(DocumentEntity) private docs: Repository<DocumentEntity>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async list(user: AuthUser) {
    const ids = await this.access.visibleSpaceIds(user);
    if (!ids.length) return [];
    const spaces = await this.spaces.createQueryBuilder('s').whereInIds(ids).orderBy('s.name', 'ASC').getMany();
    const docCounts = await this.docs
      .createQueryBuilder('d')
      .select('d.spaceId', 'spaceId')
      .addSelect('COUNT(*)', 'n')
      .where('d.spaceId IN (:...ids)', { ids })
      .groupBy('d.spaceId')
      .getRawMany<{ spaceId: string; n: string }>();
    const memberCounts = await this.members
      .createQueryBuilder('m')
      .select('m.spaceId', 'spaceId')
      .addSelect('COUNT(*)', 'n')
      .where('m.spaceId IN (:...ids)', { ids })
      .groupBy('m.spaceId')
      .getRawMany<{ spaceId: string; n: string }>();
    return spaces.map((s) => ({
      ...s,
      docCount: Number(docCounts.find((c) => c.spaceId === s.id)?.n ?? 0),
      memberCount: Number(memberCounts.find((c) => c.spaceId === s.id)?.n ?? 0),
    }));
  }

  async get(user: AuthUser, idOrKey: string) {
    const space = await this.access.resolve(idOrKey);
    const access = await this.access.requireView(user, space);
    const members = await this.members.find({ where: { spaceId: space.id } });
    return { ...space, members: members.map(memberView), access };
  }

  async create(user: AuthUser, dto: SpaceDto) {
    const key = (dto.key ?? dto.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5)).toUpperCase();
    if (key.length < 2) throw new BadRequestException('Clave de espacio inválida');
    if (await this.spaces.findOne({ where: { key } })) throw new ConflictException(`La clave ${key} ya existe`);
    const space = await this.spaces.save(
      this.spaces.create({ name: dto.name.trim(), key, description: dto.description ?? '', icon: dto.icon || '◆', visibility: dto.visibility ?? 'company', ownerId: user.id }),
    );
    await this.members.save(this.members.create({ spaceId: space.id, userId: user.id, role: 'admin' }));
    return this.get(user, space.id);
  }

  async update(user: AuthUser, idOrKey: string, dto: UpdateSpaceDto) {
    const space = await this.access.resolve(idOrKey);
    const a = await this.access.requireView(user, space);
    if (!a.canManage) throw new ForbiddenException('Solo los administradores del espacio pueden editarlo');
    Object.assign(space, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
    await this.spaces.save(space);
    return this.get(user, space.id);
  }

  async remove(user: AuthUser, idOrKey: string) {
    const space = await this.access.resolve(idOrKey);
    const a = await this.access.requireView(user, space);
    if (!a.canManage) throw new ForbiddenException('Solo los administradores del espacio pueden eliminarlo');
    await this.spaces.delete(space.id);
    return { ok: true };
  }

  async setMembers(user: AuthUser, idOrKey: string, dto: MembersDto) {
    const space = await this.access.resolve(idOrKey);
    const a = await this.access.requireView(user, space);
    if (!a.canManage) throw new ForbiddenException('Solo los administradores del espacio pueden gestionar miembros');
    const ids = dto.members.map((m) => m.userId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Miembros duplicados');
    if (ids.length && (await this.users.countBy(ids.map((id) => ({ id })))) !== ids.length) throw new BadRequestException('Usuario inexistente');
    if (!dto.members.some((m) => m.role === 'admin') && !can(user, 'spaces.manage'))
      throw new BadRequestException('El espacio necesita al menos un administrador');
    await this.members.delete({ spaceId: space.id });
    await this.members.save(dto.members.map((m) => this.members.create({ spaceId: space.id, userId: m.userId, role: m.role })));
    return this.get(user, space.id);
  }
}

@Controller('spaces')
export class SpacesController {
  constructor(private svc: SpacesService) {}
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }
  @Post() @RequirePermissions('spaces.create') create(@CurrentUser() u: AuthUser, @Body() dto: SpaceDto) {
    return this.svc.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.get(u, id);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateSpaceDto) {
    return this.svc.update(u, id, dto);
  }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.remove(u, id);
  }
  @Put(':id/members') members(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: MembersDto) {
    return this.svc.setMembers(u, id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Space, SpaceMember, DocumentEntity, User])],
  controllers: [SpacesController],
  providers: [AccessService, SpacesService],
  exports: [AccessService],
})
export class SpacesModule {}
