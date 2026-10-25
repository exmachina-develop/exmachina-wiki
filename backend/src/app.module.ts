import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { AuthModule } from './auth/auth.module';
import { IamModule } from './iam/iam.module';
import { SpacesModule } from './spaces/spaces.module';
import { OrgModule } from './org/org.module';
import { FilesModule } from './files/files.module';
import { DocumentsModule } from './documents/documents.module';
import { SeedService } from './seed/seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'postgres',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: ALL_ENTITIES,
      synchronize: true,
      retryAttempts: 20,
      retryDelay: 3000,
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    AuthModule,
    IamModule,
    SpacesModule,
    OrgModule,
    FilesModule,
    DocumentsModule,
  ],
  providers: [
    SeedService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
