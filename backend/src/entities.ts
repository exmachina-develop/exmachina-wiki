import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SpaceVisibility = 'company' | 'private';
export type SpaceRole = 'admin' | 'editor' | 'viewer';

export interface PageSettings {
  size: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margin: number; // mm
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) name: string;
  @Column({ default: '' }) description: string;
  @Column('text', { array: true, default: () => "'{}'" }) permissions: string[];
  @Column({ default: false }) isSystem: boolean;
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Index({ unique: true }) @Column() email: string;
  @Column({ select: false }) passwordHash: string;
  @Column({ nullable: true }) roleId: string;
  @ManyToOne(() => Role, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role: Role;
  @Column({ default: '' }) jobTitle: string;
  @Column({ default: '#7047FF' }) color: string;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('spaces')
export class Space {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() key: string;
  @Column() name: string;
  @Column({ default: '' }) description: string;
  @Column({ default: '◆' }) icon: string;
  @Column({ type: 'varchar', default: 'company' }) visibility: SpaceVisibility;
  @Column({ nullable: true }) ownerId: string;
  @OneToMany(() => SpaceMember, (m) => m.space) members: SpaceMember[];
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('space_members')
export class SpaceMember {
  @PrimaryColumn('uuid') spaceId: string;
  @PrimaryColumn('uuid') userId: string;
  @ManyToOne(() => Space, (s) => s.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space: Space;
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Column({ type: 'varchar', default: 'editor' }) role: SpaceRole;
}

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ default: '' }) description: string;
  @Column({ default: '#416BFF' }) color: string;
  @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ type: 'int', default: 0 }) position: number;
  @OneToMany(() => DepartmentMember, (m) => m.department) members: DepartmentMember[];
}

@Entity('department_members')
export class DepartmentMember {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') departmentId: string;
  @Column('uuid') userId: string;
  @ManyToOne(() => Department, (d) => d.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'departmentId' })
  department: Department;
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;
  @Column({ default: false }) isHead: boolean;
  @Column({ default: '' }) title: string;
}

@Entity('documents')
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') spaceId: string;
  @ManyToOne(() => Space, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space: Space;
  @Column({ type: 'uuid', nullable: true }) parentId: string | null;
  @Column({ default: 'Documento sin título' }) title: string;
  @Column({ default: '' }) icon: string;
  @Column({ type: 'text', default: '' }) content: string;
  @Column({ type: 'text', default: '' }) contentText: string;
  @Column({ type: 'varchar', default: 'native' }) source: 'native' | 'pdf';
  @Column({ type: 'uuid', nullable: true }) sourceFileId: string | null;
  @Column({ type: 'jsonb', default: () => `'{"size":"A4","orientation":"portrait","margin":20}'` })
  pageSettings: PageSettings;
  @Column({ type: 'int', default: 0 }) position: number;
  @Column({ type: 'uuid', nullable: true }) authorId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'authorId' })
  author: User | null;
  @Column({ type: 'uuid', nullable: true }) updatedById: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'updatedById' })
  updatedBy: User | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('document_versions')
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') documentId: string;
  @ManyToOne(() => DocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documentId' })
  document: DocumentEntity;
  @Column() title: string;
  @Column({ type: 'text' }) content: string;
  @Column({ type: 'uuid', nullable: true }) authorId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL', eager: true })
  @JoinColumn({ name: 'authorId' })
  author: User | null;
  @Column({ default: '' }) note: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('files')
export class FileAsset {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() objectKey: string;
  @Column() filename: string;
  @Column() mime: string;
  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  size: number;
  @Column({ type: 'varchar', default: 'attachment' }) kind: 'image' | 'pdf' | 'attachment';
  @Column({ type: 'uuid', nullable: true }) uploaderId: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ALL_ENTITIES = [
  Role,
  User,
  Space,
  SpaceMember,
  Department,
  DepartmentMember,
  DocumentEntity,
  DocumentVersion,
  FileAsset,
];
