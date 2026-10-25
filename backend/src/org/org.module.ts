import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Repository } from 'typeorm';
import { Department, DepartmentMember, User } from '../entities';
import { RequirePermissions } from '../common/permissions';

class DepartmentDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsInt() position?: number;
}
class OrgMemberDto {
  @IsUUID() userId: string;
  @IsBoolean() isHead: boolean;
  @IsOptional() @IsString() @MaxLength(100) title?: string;
}
class OrgMembersDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OrgMemberDto) members: OrgMemberDto[];
}

@Injectable()
export class OrgService {
  constructor(
    @InjectRepository(Department) private deps: Repository<Department>,
    @InjectRepository(DepartmentMember) private members: Repository<DepartmentMember>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async tree() {
    const deps = await this.deps.find({ order: { position: 'ASC', name: 'ASC' } });
    const members = await this.members.find();
    return deps.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      color: d.color,
      parentId: d.parentId,
      position: d.position,
      members: members
        .filter((m) => m.departmentId === d.id)
        .sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.user.name.localeCompare(b.user.name))
        .map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, color: m.user.color, jobTitle: m.user.jobTitle, isHead: m.isHead, title: m.title })),
    }));
  }

  private async assertNoCycle(id: string | null, parentId: string | null | undefined) {
    if (!parentId) return;
    if (!(await this.deps.findOne({ where: { id: parentId } }))) throw new BadRequestException('Área superior inexistente');
    if (!id) return;
    let cur: string | null = parentId;
    for (let i = 0; cur && i < 100; i++) {
      if (cur === id) throw new BadRequestException('Una área no puede depender de sí misma ni de sus descendientes');
      cur = (await this.deps.findOne({ where: { id: cur } }))?.parentId ?? null;
    }
  }

  async create(dto: DepartmentDto) {
    await this.assertNoCycle(null, dto.parentId);
    const d = await this.deps.save(
      this.deps.create({ name: dto.name.trim(), description: dto.description ?? '', color: dto.color ?? '#416BFF', parentId: dto.parentId ?? null, position: dto.position ?? 0 }),
    );
    return d;
  }

  async update(id: string, dto: DepartmentDto) {
    const d = await this.deps.findOne({ where: { id } });
    if (!d) throw new NotFoundException();
    if (dto.parentId !== undefined) await this.assertNoCycle(id, dto.parentId);
    d.name = dto.name.trim();
    if (dto.description !== undefined) d.description = dto.description;
    if (dto.color) d.color = dto.color;
    if (dto.parentId !== undefined) d.parentId = dto.parentId;
    if (dto.position !== undefined) d.position = dto.position;
    return this.deps.save(d);
  }

  async remove(id: string) {
    const d = await this.deps.findOne({ where: { id } });
    if (!d) throw new NotFoundException();
    await this.deps.update({ parentId: id }, { parentId: d.parentId });
    await this.deps.delete(id);
    return { ok: true };
  }

  async setMembers(id: string, dto: OrgMembersDto) {
    if (!(await this.deps.findOne({ where: { id } }))) throw new NotFoundException();
    const ids = dto.members.map((m) => m.userId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Miembros duplicados');
    if (ids.length && (await this.users.countBy(ids.map((u) => ({ id: u })))) !== ids.length) throw new BadRequestException('Usuario inexistente');
    await this.members.delete({ departmentId: id });
    await this.members.save(dto.members.map((m) => this.members.create({ departmentId: id, userId: m.userId, isHead: m.isHead, title: m.title ?? '' })));
    return this.tree();
  }
}

@Controller('org')
export class OrgController {
  constructor(private svc: OrgService) {}
  @Get() tree() {
    return this.svc.tree();
  }
  @Post() @RequirePermissions('org.manage') create(@Body() dto: DepartmentDto) {
    return this.svc.create(dto);
  }
  @Patch(':id') @RequirePermissions('org.manage') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DepartmentDto) {
    return this.svc.update(id, dto);
  }
  @Delete(':id') @RequirePermissions('org.manage') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
  @Put(':id/members') @RequirePermissions('org.manage') members(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrgMembersDto) {
    return this.svc.setMembers(id, dto);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Department, DepartmentMember, User])],
  controllers: [OrgController],
  providers: [OrgService],
})
export class OrgModule {}
