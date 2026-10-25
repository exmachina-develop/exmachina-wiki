export interface UserRef { id: string; name: string; color: string }

export interface Profile {
  id: string; username: string; name: string; email: string; jobTitle: string; color: string;
  role: { id: string; name: string }; permissions: string[];
}

export interface DirUser {
  id: string; username: string; name: string; email: string; jobTitle: string; color: string; active: boolean;
  lastLoginAt: string | null; role: { id: string; name: string } | null;
}

export interface Role { id: string; name: string; description: string; permissions: string[]; isSystem: boolean; users: number }
export interface PermissionDef { key: string; group: string; label: string }

export type SpaceRole = 'admin' | 'editor' | 'viewer';
export interface SpaceMemberView { userId: string; role: SpaceRole; name: string; email: string; color: string }
export interface Space {
  id: string; key: string; name: string; description: string; icon: string;
  visibility: 'company' | 'private'; docCount?: number; memberCount?: number;
  members?: SpaceMemberView[]; access?: { canView: boolean; canEdit: boolean; canManage: boolean };
}

export interface PageSettings { size: 'A4' | 'Letter'; orientation: 'portrait' | 'landscape'; margin: number }

export interface DocBrief {
  id: string; spaceId: string; parentId: string | null; title: string; icon: string;
  source: 'native' | 'pdf'; position: number; updatedAt: string; createdAt: string;
  author: UserRef | null; updatedBy: UserRef | null;
  space?: { id: string; key: string; name: string; icon: string };
}
export interface Doc extends DocBrief {
  content: string; pageSettings: PageSettings;
  space: { id: string; key: string; name: string; icon: string };
  access: { canEdit: boolean; canDelete: boolean; canExport: boolean };
}
export interface DocVersion { id: string; title: string; note: string; createdAt: string; author: UserRef | null; content?: string }
export interface SearchHit { id: string; title: string; icon: string; snippet: string; updatedAt: string; space: { id: string; key: string; name: string } }

export interface OrgMember { userId: string; name: string; email: string; color: string; jobTitle: string; isHead: boolean; title: string }
export interface Department { id: string; name: string; description: string; color: string; parentId: string | null; position: number; members: OrgMember[] }
