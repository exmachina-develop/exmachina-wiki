import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Brackets, Repository } from 'typeorm';
import sanitizeHtml from 'sanitize-html';
import { AttachmentInfo, DocumentEntity, DocumentVersion, FileAsset, PageSettings } from '../entities';
import { AuthUser, CurrentUser, RequirePermissions, can } from '../common/permissions';
import { AccessService, SpacesModule } from '../spaces/spaces.module';
import { FilesModule, FilesService } from '../files/files.module';
import { ForbiddenException } from '@nestjs/common';

type ImportKind = 'pdf';
const IMPORT_MIME: Record<ImportKind, string> = { pdf: 'application/pdf' };
const ATTACH_EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const ATTACH_MIMES = [...Object.values(ATTACH_EXT_MIME), 'image/png', 'image/jpeg', 'text/plain', 'text/csv', 'application/zip'];

const DEFAULT_PAGE: PageSettings = { size: 'A4', orientation: 'portrait', margin: 20 };
const FILE_URL_RE = /\/api\/files\/([0-9a-f-]{36})\/raw/gi;
const VERSION_GAP_MS = 10 * 60 * 1000;

class PageSettingsDto {
  @IsIn(['A4', 'Letter']) size: 'A4' | 'Letter';
  @IsIn(['portrait', 'landscape']) orientation: 'portrait' | 'landscape';
  @IsNumber() @Min(5) @Max(50) margin: number;
}
class CreateDocDto {
  @IsUUID() spaceId: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) content?: string;
}
class UpdateDocDto {
  @IsOptional() @IsString() @MaxLength(250) title?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) content?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @ValidateNested() @Type(() => PageSettingsDto) pageSettings?: PageSettingsDto;
  @IsOptional() @IsBoolean() snapshot?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

const ALLOWED_STYLES = {
  '*': {
    'text-align': [/^(left|right|center|justify)$/],
    'font-family': [/^[\w\s,'"\-]+$/],
    'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
    'line-height': [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
    color: [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
    'background-color': [/^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
    'text-indent': [/^\d+(\.\d+)?(px|pt|em|rem)$/],
    width: [/^\d+(\.\d+)?(px|%|em|pt)$/],
    'min-width': [/^\d+(\.\d+)?(px|%|em|pt)$/],
    height: [/^\d+(\.\d+)?(px|%|em|pt)$/],
    'vertical-align': [/^(top|middle|bottom|baseline)$/],
    'margin-left': [/^\d+(\.\d+)?(px|pt|em|rem)$/],
    border: [/^[\w\s#(),.%-]+$/],
    'border-bottom': [/^[\w\s#(),.%-]+$/],
    'border-top': [/^[\w\s#(),.%-]+$/],
    padding: [/^\d+(\.\d+)?(px|pt|em|rem)?(\s+\d+(\.\d+)?(px|pt|em|rem)?){0,3}$/],
  },
};

export const sanitizeDoc = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'br', 'hr', 'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'span', 'div', 'mark'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      td: ['colspan', 'rowspan', 'colwidth', 'style'],
      th: ['colspan', 'rowspan', 'colwidth', 'style'],
      col: ['style', 'span'],
      table: ['style'],
      ol: ['start', 'type'],
      '*': ['style', 'data-indent'],
      mark: ['style', 'data-color'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true) },
  });

const toText = (html: string) =>
  sanitizeHtml(html.replace(/<\/(p|h\d|li|tr|div)>/gi, ' '), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const brief = (d: DocumentEntity) => ({
  id: d.id,
  spaceId: d.spaceId,
  parentId: d.parentId,
  title: d.title,
  icon: d.icon,
  source: d.source,
  position: d.position,
  updatedAt: d.updatedAt,
  createdAt: d.createdAt,
  author: d.author ? { id: d.author.id, name: d.author.name, color: d.author.color } : null,
  updatedBy: d.updatedBy ? { id: d.updatedBy.id, name: d.updatedBy.name, color: d.updatedBy.color } : null,
});

@Injectable()
export class PdfClient {
  private base = process.env.PDF_SERVICE_URL ?? 'http://pdf-service:8000';

  async toHtml(buf: Buffer, filename: string, kind: ImportKind = 'pdf'): Promise<{ html: string; title: string; pages: number; warnings: string[]; page?: PageSettings }> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: IMPORT_MIME[kind] }), filename);
    const res = await this.call('/pdf/to-html', { method: 'POST', body: form });
    return res.json() as any;
  }

  async fromHtml(html: string, title: string, page: PageSettings): Promise<Buffer> {
    const res = await this.call('/pdf/from-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, title, page }),
    });
    return Buffer.from(await res.arrayBuffer());
  }

  private async call(path: string, init: RequestInit) {
    let res: Response | globalThis.Response;
    try {
      res = await fetch(this.base + path, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch {
      throw new ServiceUnavailableException('El servicio de PDF no está disponible');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new BadRequestException(`No se pudo procesar el PDF${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    return res as globalThis.Response;
  }
}

@Injectable()
export class DocumentsService {
  private log = new Logger('Documents');

  constructor(
    private access: AccessService,
    private files: FilesService,
    private pdf: PdfClient,
    @InjectRepository(DocumentEntity) private docs: Repository<DocumentEntity>,
    @InjectRepository(DocumentVersion) private versions: Repository<DocumentVersion>,
  ) {}

  private async load(id: string) {
    const d = await this.docs.findOne({ where: { id }, relations: { space: true } });
    if (!d) throw new NotFoundException('Documento no encontrado');
    return d;
  }

  async list(user: AuthUser, spaceId: string) {
    const space = await this.access.resolve(spaceId);
    await this.access.requireView(user, space);
    const rows = await this.docs.find({ where: { spaceId: space.id }, order: { position: 'ASC', title: 'ASC' }, select: { content: false, contentText: false } as any });
    return rows.map(brief);
  }

  async recent(user: AuthUser, limit = 12) {
    const ids = await this.access.visibleSpaceIds(user);
    if (!ids.length) return [];
    const rows = await this.docs
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.space', 's')
      .leftJoinAndSelect('d.updatedBy', 'ub')
      .leftJoinAndSelect('d.author', 'a')
      .select(['d.id', 'd.spaceId', 'd.title', 'd.icon', 'd.source', 'd.updatedAt', 'd.createdAt', 'd.parentId', 'd.position', 's.id', 's.key', 's.name', 's.icon', 'ub.id', 'ub.name', 'ub.color', 'a.id', 'a.name', 'a.color'])
      .where('d.spaceId IN (:...ids)', { ids })
      .orderBy('d.updatedAt', 'DESC')
      .limit(Math.min(limit, 50))
      .getMany();
    return rows.map((d) => ({ ...brief(d), space: { id: d.space.id, key: d.space.key, name: d.space.name, icon: d.space.icon } }));
  }

  async search(user: AuthUser, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const ids = await this.access.visibleSpaceIds(user);
    if (!ids.length) return [];
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await this.docs
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.space', 's')
      .where('d.spaceId IN (:...ids)', { ids })
      .andWhere(new Brackets((w) => w.where('d.title ILIKE :like', { like }).orWhere('d.contentText ILIKE :like', { like })))
      .orderBy('d.updatedAt', 'DESC')
      .limit(30)
      .getMany();
    const needle = term.toLowerCase();
    return rows.map((d) => {
      const i = d.contentText.toLowerCase().indexOf(needle);
      const snippet = i < 0 ? d.contentText.slice(0, 140) : `${i > 50 ? '…' : ''}${d.contentText.slice(Math.max(0, i - 50), i + 110)}…`;
      return { id: d.id, title: d.title, icon: d.icon, snippet, updatedAt: d.updatedAt, space: { id: d.space.id, key: d.space.key, name: d.space.name } };
    });
  }

  async get(user: AuthUser, id: string) {
    const d = await this.load(id);
    const a = await this.access.requireView(user, d.space);
    return {
      ...brief(d),
      content: d.content,
      pageSettings: d.pageSettings,
      space: { id: d.space.id, key: d.space.key, name: d.space.name, icon: d.space.icon },
      access: { canEdit: a.canEdit && can(user, 'documents.edit'), canDelete: a.canEdit && can(user, 'documents.delete'), canExport: can(user, 'documents.export') },
    };
  }

  private async nextPosition(spaceId: string, parentId: string | null) {
    const { max } = (await this.docs
      .createQueryBuilder('d')
      .select('COALESCE(MAX(d.position), -1)', 'max')
      .where('d.spaceId = :spaceId', { spaceId })
      .andWhere(parentId ? 'd.parentId = :parentId' : 'd.parentId IS NULL', { parentId })
      .getRawOne()) as { max: number };
    return Number(max) + 1;
  }

  private async assertParent(spaceId: string, parentId: string | null | undefined, selfId?: string) {
    if (!parentId) return;
    let cur: string | null = parentId;
    for (let i = 0; cur && i < 100; i++) {
      if (cur === selfId) throw new BadRequestException('Un documento no puede colgar de sí mismo');
      const p: DocumentEntity | null = await this.docs.findOne({ where: { id: cur }, select: ['id', 'spaceId', 'parentId'] });
      if (!p || p.spaceId !== spaceId) throw new BadRequestException('Documento padre inválido');
      cur = p.parentId;
    }
  }

  async create(user: AuthUser, dto: CreateDocDto) {
    if (!can(user, 'documents.create')) throw new ForbiddenException('No tienes permiso para crear documentos');
    const space = await this.access.resolve(dto.spaceId);
    await this.access.requireEdit(user, space);
    await this.assertParent(space.id, dto.parentId);
    const content = sanitizeDoc(dto.content ?? '<p></p>');
    const d = await this.docs.save(
      this.docs.create({
        spaceId: space.id,
        parentId: dto.parentId ?? null,
        title: dto.title?.trim() || 'Documento sin título',
        icon: dto.icon ?? '',
        content,
        contentText: toText(content),
        authorId: user.id,
        updatedById: user.id,
        position: await this.nextPosition(space.id, dto.parentId ?? null),
      }),
    );
    return this.get(user, d.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateDocDto) {
    const d = await this.load(id);
    await this.access.requireEdit(user, d.space);
    if (!can(user, 'documents.edit')) throw new ForbiddenException('No tienes permiso para editar documentos');
    const contentChanged = dto.content !== undefined || (dto.title !== undefined && dto.title.trim() !== d.title);

    if (contentChanged) {
      // Autosave history: keep the state being replaced at most once per VERSION_GAP_MS.
      const last = await this.versions.findOne({ where: { documentId: d.id }, order: { createdAt: 'DESC' } });
      if (!last || Date.now() - last.createdAt.getTime() > VERSION_GAP_MS)
        await this.versions.save(this.versions.create({ documentId: d.id, title: d.title, content: d.content, authorId: d.updatedById ?? d.authorId, note: '' }));
    }

    if (dto.title !== undefined) d.title = dto.title.trim() || 'Documento sin título';
    if (dto.icon !== undefined) d.icon = dto.icon;
    if (dto.content !== undefined) {
      d.content = sanitizeDoc(dto.content);
      d.contentText = toText(d.content);
    }
    if (dto.pageSettings) d.pageSettings = { ...DEFAULT_PAGE, ...dto.pageSettings };
    if (dto.parentId !== undefined) {
      await this.assertParent(d.spaceId, dto.parentId, d.id);
      if (dto.parentId !== d.parentId) d.position = await this.nextPosition(d.spaceId, dto.parentId);
      d.parentId = dto.parentId;
    }
    if (dto.position !== undefined) d.position = dto.position;
    d.updatedById = user.id;
    d.updatedBy = null;
    d.author = d.author; // keep eager relation consistent
    await this.docs.save(d);

    if (dto.snapshot) {
      await this.versions.save(this.versions.create({ documentId: d.id, title: d.title, content: d.content, authorId: user.id, note: dto.note ?? 'Versión guardada manualmente' }));
    }
    return this.get(user, d.id);
  }

  async remove(user: AuthUser, id: string) {
    const d = await this.load(id);
    const a = await this.access.requireEdit(user, d.space);
    if (!a.canEdit || !can(user, 'documents.delete')) throw new ForbiddenException('No tienes permiso para eliminar documentos');
    await this.docs.update({ parentId: d.id }, { parentId: d.parentId });
    await this.docs.delete(d.id);
    return { ok: true };
  }

  async listVersions(user: AuthUser, id: string) {
    const d = await this.load(id);
    await this.access.requireView(user, d.space);
    const rows = await this.versions.find({ where: { documentId: id }, order: { createdAt: 'DESC' }, take: 100, select: { content: false } as any });
    return rows.map((v) => ({ id: v.id, title: v.title, note: v.note, createdAt: v.createdAt, author: v.author ? { id: v.author.id, name: v.author.name, color: v.author.color } : null }));
  }

  async getVersion(user: AuthUser, id: string, vid: string) {
    const d = await this.load(id);
    await this.access.requireView(user, d.space);
    const v = await this.versions.findOne({ where: { id: vid, documentId: id } });
    if (!v) throw new NotFoundException();
    return { id: v.id, title: v.title, content: v.content, createdAt: v.createdAt, note: v.note };
  }

  async restore(user: AuthUser, id: string, vid: string) {
    const d = await this.load(id);
    await this.access.requireEdit(user, d.space);
    if (!can(user, 'documents.edit')) throw new ForbiddenException();
    const v = await this.versions.findOne({ where: { id: vid, documentId: id } });
    if (!v) throw new NotFoundException();
    await this.versions.save(this.versions.create({ documentId: d.id, title: d.title, content: d.content, authorId: user.id, note: 'Antes de restaurar una versión' }));
    d.title = v.title;
    d.content = v.content;
    d.contentText = toText(v.content);
    d.updatedById = user.id;
    d.updatedBy = null;
    await this.docs.save(d);
    return this.get(user, d.id);
  }

  /** PDF → editable document (the original file is not stored: the wiki document is the source of truth). */
  async importFile(user: AuthUser, file: Express.Multer.File | undefined, spaceId: string, parentId?: string) {
    if (!can(user, 'documents.import') || !can(user, 'documents.create')) throw new ForbiddenException('No tienes permiso para importar archivos');
    if (!file) throw new BadRequestException('Falta el archivo');
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = (filename.split('.').pop() ?? '').toLowerCase() as ImportKind;
    if (!(ext in IMPORT_MIME)) throw new BadRequestException('Formato no soportado: solo PDF');
    const magic = file.buffer.subarray(0, 5).toString('latin1');
    if (ext === 'pdf' ? magic !== '%PDF-' : !magic.startsWith('PK')) throw new BadRequestException(`El archivo no es un .${ext} válido`);
    const space = await this.access.resolve(spaceId);
    await this.access.requireEdit(user, space);
    if (parentId) await this.assertParent(space.id, parentId);

    const result = await this.pdf.toHtml(file.buffer, filename, ext);

    // Extract embedded data-URI images into MinIO.
    let html = result.html;
    const uris = [...new Set(html.match(/data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+/g) ?? [])];
    for (const uri of uris) {
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(uri)!;
      const f = await this.files.save(Buffer.from(m[2], 'base64'), `imagen.${m[1].split('/')[1]}`, m[1], user.id, 'image');
      html = html.split(uri).join(`/api/files/${f.id}/raw`);
    }
    const content = sanitizeDoc(html);
    const title = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 250) || result.title;
    const d = await this.docs.save(
      this.docs.create({
        spaceId: space.id,
        parentId: parentId ?? null,
        title,
        content,
        contentText: toText(content),
        source: ext,
        pageSettings: result.page ? { ...DEFAULT_PAGE, ...result.page } : DEFAULT_PAGE,
        authorId: user.id,
        updatedById: user.id,
        position: await this.nextPosition(space.id, parentId ?? null),
      }),
    );
    return { document: await this.get(user, d.id), warnings: result.warnings, pages: result.pages };
  }

  /** Document → PDF with the editor formatting (WeasyPrint in the Python service). */
  async exportPdf(user: AuthUser, id: string) {
    if (!can(user, 'documents.export')) throw new ForbiddenException('No tienes permiso para exportar');
    const d = await this.load(id);
    await this.access.requireView(user, d.space);
    // Inline images (they live behind our API) so the PDF service needs no network access to us.
    let html = d.content;
    const ids = [...new Set([...html.matchAll(FILE_URL_RE)].map((m) => m[1]))];
    for (const fid of ids) {
      try {
        const f: FileAsset = await this.files.find(fid);
        if (f.kind !== 'image') continue;
        const uri = `data:${f.mime};base64,${(await this.files.bytes(f)).toString('base64')}`;
        html = html.replace(new RegExp(`(?:https?://[^"'\\s]+)?/api/files/${fid}/raw`, 'g'), uri);
      } catch (e) {
        this.log.warn(`No se pudo incrustar la imagen ${fid}`);
      }
    }
    const buf = await this.pdf.fromHtml(html, d.title, { ...DEFAULT_PAGE, ...d.pageSettings });
    return { buf, filename: `${d.title.replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]+/g, '').trim() || 'documento'}.pdf` };
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(private svc: DocumentsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('spaceId') spaceId: string) {
    if (!spaceId) throw new BadRequestException('spaceId es obligatorio');
    return this.svc.list(u, spaceId);
  }
  @Get('recent') recent(@CurrentUser() u: AuthUser) {
    return this.svc.recent(u);
  }
  @Get('search') search(@CurrentUser() u: AuthUser, @Query('q') q = '') {
    return this.svc.search(u, q);
  }
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  import(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body('spaceId') spaceId: string, @Body('parentId') parentId?: string) {
    if (!spaceId) throw new BadRequestException('spaceId es obligatorio');
    return this.svc.importFile(u, file, spaceId, parentId || undefined);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateDocDto) {
    return this.svc.create(u, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, id);
  }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocDto) {
    return this.svc.update(u, id, dto);
  }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
  @Get(':id/versions') versions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listVersions(u, id);
  }
  @Get(':id/versions/:vid') version(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.svc.getVersion(u, id, vid);
  }
  @Post(':id/versions/:vid/restore') restore(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    return this.svc.restore(u, id, vid);
  }
  @Get(':id/export/pdf')
  async exportPdf(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buf, filename } = await this.svc.exportPdf(u, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([DocumentEntity, DocumentVersion]), SpacesModule, FilesModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, PdfClient],
})
export class DocumentsModule {}
