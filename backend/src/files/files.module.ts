import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'minio';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { AuthModule } from '../auth/auth.module';
import { FileAsset } from '../entities';
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../common/permissions';

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_BYTES = 50 * 1024 * 1024;

@Injectable()
export class StorageService implements OnModuleInit {
  private log = new Logger('Storage');
  private client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? 'minio',
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY!,
    secretKey: process.env.MINIO_SECRET_KEY!,
  });
  private bucket = process.env.MINIO_BUCKET ?? 'wiki';

  async onModuleInit() {
    for (let i = 0; i < 20; i++) {
      try {
        if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket);
        this.log.log(`Bucket "${this.bucket}" listo`);
        return;
      } catch (e) {
        this.log.warn(`MinIO no disponible, reintentando (${i + 1})…`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error('No se pudo conectar con MinIO');
  }

  put(key: string, data: Buffer, mime: string) {
    return this.client.putObject(this.bucket, key, data, data.length, { 'Content-Type': mime });
  }
  stream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }
  async buffer(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of await this.stream(key)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
}

@Injectable()
export class FilesService {
  constructor(private storage: StorageService, @InjectRepository(FileAsset) private files: Repository<FileAsset>) {}

  /** Stores a buffer in MinIO and records it. */
  async save(buf: Buffer, filename: string, mime: string, uploaderId: string | null, kind?: FileAsset['kind']) {
    const k = kind ?? (IMAGE_MIMES.includes(mime) ? 'image' : mime === 'application/pdf' ? 'pdf' : 'attachment');
    const id = randomUUID();
    const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-120);
    const objectKey = `${new Date().getFullYear()}/${id}/${safe}`;
    await this.storage.put(objectKey, buf, mime);
    return this.files.save(this.files.create({ id, objectKey, filename: safe, mime, size: buf.length, kind: k, uploaderId }));
  }

  async find(id: string) {
    const f = await this.files.findOne({ where: { id } });
    if (!f) throw new NotFoundException('Archivo no encontrado');
    return f;
  }

  open(f: FileAsset) {
    return this.storage.stream(f.objectKey);
  }
  bytes(f: FileAsset) {
    return this.storage.buffer(f.objectKey);
  }
}

@Controller('files')
export class FilesController {
  constructor(private svc: FilesService, private jwt: JwtService) {}

  @Post()
  @RequirePermissions('files.upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Falta el archivo');
    const f = await this.svc.save(file.buffer, Buffer.from(file.originalname, 'latin1').toString('utf8'), file.mimetype, u.id);
    return { id: f.id, filename: f.filename, mime: f.mime, size: f.size, kind: f.kind, url: `/api/files/${f.id}/raw` };
  }

  /** Images are served by unguessable UUID (they are embedded in <img> tags); every other file needs a valid token. */
  @Public()
  @Get(':id/raw')
  async raw(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res() res: Response) {
    const f = await this.svc.find(id);
    if (f.kind !== 'image') {
      const token = req.headers.authorization?.replace(/^Bearer /i, '');
      try {
        if (!token) throw new Error();
        await this.jwt.verifyAsync(token);
      } catch {
        throw new UnauthorizedException();
      }
    }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `${f.kind === 'attachment' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    (await this.svc.open(f)).pipe(res);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([FileAsset]), AuthModule],
  controllers: [FilesController],
  providers: [StorageService, FilesService],
  exports: [FilesService],
})
export class FilesModule {}
