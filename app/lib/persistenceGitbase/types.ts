export interface RepositoryItem {
  projectId: string;
  urlId: string;
  id: string;
  description: string;
  timestamp: string;
}

export interface GitlabUser {
  id: number;
  username: string;
  email: string;
  name: string;
  namespace_id: number;
  is_admin: boolean;
}

export interface GitlabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  namespace: {
    id: number;
    name: string;
    path: string;
    kind: string;
  };
  default_branch?: string;
  last_commit?: {
    id: string;
    message: string;
    created_at: string;
    author_name: string;
  } | null;
  created_at?: string;
  updated_at?: string;
  description?: string;
  visibility?: string;
}

export interface GitlabProtectedBranch {
  name: string;
  push_access_levels: any[];
  merge_access_levels: any[];
}

export interface GitlabCommit {
  id: string;
  short_id?: string;
  title?: string;
  message: string;
  created_at: string;
  committed_date?: string;
  author_name?: string;
  author_email?: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
}

export interface CommitAction {
  action: 'create' | 'delete' | 'move' | 'update' | 'chmod';
  filePath: string;
  content?: string;
  encoding?: string;
  lastCommitId?: string;
}

export interface FileContent {
  path: string;
  content: string;
}

export interface DevTokenResponse {
  token: string;
  id: number;
  name: string;
  scopes: string[];
  expires_at: string;
  access_level: number;
}

export interface DevTokenStatus {
  hasToken: boolean;
  expiresAt?: string;
  daysLeft?: number;
  tokenName?: string;
}

export interface GitCommands {
  projectInfo: {
    path: string;
    gitUrl: string;
    defaultBranch: string;
    hasActiveToken: boolean;
    tokenExpiresAt?: string;
    daysLeft?: number;
  };
  setup: {
    clone: string;
    remoteUpdate: string[];
    basicWorkflow: string[];
    branchStrategy: string[];
  };
  troubleshooting: string[];
  security: string[];
}
