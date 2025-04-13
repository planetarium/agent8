export interface RepositoryItem {
  projectId: string;
  urlId: string;
  id: string;
  description: string;
  timestamp: string;
}

export interface CommitFile {
  path: string;
  content: string;
}

export interface CommitFilesResponse {
  success: boolean;
  data?: {
    commitHash: string;
    message: string;
    timestamp: string;
    repository: {
      name: string;
      path: string;
      description: string;
    };
  };
}

export interface CreateRepositoryResponse {
  success: boolean;
  data?: {
    id: number;
    name: string;
    path: string;
    description: string;
    user: {
      id: number;
      username: string;
    };
  };
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

// DTO 정의
export interface CreateProjectDto {
  email: string;
  projectName: string;
  description?: string;
}

export interface CommitCodeDto {
  email: string;
  projectName: string;
  zipFile: Buffer;
  commitMessage: string;
}

export interface CommitFilesDto {
  projectId: number;
  files: {
    path: string;
    content: string;
  }[];
  commitMessage: string;
  branch?: string;
}

export interface CommitFilesWithProjectDto {
  email: string;
  projectName: string;
  files: {
    path: string;
    content: string;
  }[];
  commitMessage: string;
  branch?: string;
}

export interface DownloadCodeDto {
  projectPath: string;
  commitSha?: string;
}

export interface GetProjectCommitsDto {
  projectPath: string;
  page?: string;
  perPage?: string;
  branch?: string;
}

export interface DeleteProjectDto {
  projectId: number | string;
}

export interface UpdateProjectDescriptionDto {
  projectPath: string;
  description: string;
}
