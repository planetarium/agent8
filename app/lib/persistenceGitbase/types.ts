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
