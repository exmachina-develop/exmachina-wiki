import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Injectable, UnauthorizedException, Controller, Post, Get, Patch, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities';
import { AuthUser, CurrentUser, Public } from '../common/permissions';

class LoginDto {
  @IsString() @MaxLength(120) username: string;
  @IsString() password: string;
}
class ChangePasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(8) @MaxLength(100) next: string;
}
class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
}

const toAuthUser = (u: User): AuthUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  roleName: u.role?.name ?? '',
  permissions: u.role?.permissions ?? [],
});

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectRepository(User) private users: Repository<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET!,
    });
  }
  async validate(payload: { sub: string }): Promise<AuthUser> {
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException();
    return toAuthUser(user);
  }
}

@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private users: Repository<User>, private jwt: JwtService) {}

  profile(u: User) {
    return {
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      jobTitle: u.jobTitle,
      color: u.color,
      role: { id: u.role?.id, name: u.role?.name },
      permissions: u.role?.permissions ?? [],
    };
  }

  async login(username: string, password: string) {
    const id = username.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'role')
      .addSelect('u.passwordHash')
      .where('LOWER(u.username) = :id OR u.email = :id', { id })
      .getOne();
    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Credenciales incorrectas');
    await this.users.update(user.id, { lastLoginAt: new Date() });
    return { token: await this.jwt.signAsync({ sub: user.id }), user: this.profile(user) };
  }

  async me(id: string) {
    return this.profile(await this.users.findOneOrFail({ where: { id } }));
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    await this.users.update(id, { ...(dto.name ? { name: dto.name } : {}), ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle } : {}) });
    return this.me(id);
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id }).getOne();
    if (!user || !(await bcrypt.compare(dto.current, user.passwordHash))) throw new UnauthorizedException('Contraseña actual incorrecta');
    await this.users.update(id, { passwordHash: await bcrypt.hash(dto.next, 11) });
    return { ok: true };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }

  @Patch('me')
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(u.id, dto);
  }

  @Post('change-password')
  change(@CurrentUser() u: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(u.id, dto);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '12h' } }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
