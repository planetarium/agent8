// Type definitions
interface CommitFile {
  path: string;
  content: string;
}

interface CommitFilesResponse {
  success: boolean;
  data?: {
    commitHash: string;
    message: string;
    timestamp: string;
    repository: {
      name: string;
      path: string;
    };
  };
}

interface CreateRepositoryResponse {
  id: number;
  name: string;
  path: string;
  user: {
    id: number;
    username: string;
  };
}

/**
 * Creates a new repository
 *
 * @param env Environment variables
 * @param email User email address
 * @param repositoryName Repository name
 * @returns Response with repository information
 */
export async function createRepository(
  env: Env,
  email: string,
  repositoryName: string,
  description: string,
): Promise<CreateRepositoryResponse> {
  try {
    const response = await fetch(`${env.REPO_MANAGER_URL}/git/repositories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        repositoryName,
        description,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create repository: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating repository:', error);
    throw error;
  }
}

/**
 * Commits files to a repository
 *
 * @param env Environment variables
 * @param email User email address
 * @param repositoryName Repository name
 * @param files Array of files with path and content
 * @param commitMessage Commit message
 * @param branch Branch name (default: 'develop')
 * @returns Response with commit information
 */
export async function commitFilesToRepo(
  env: Env,
  email: string,
  repositoryName: string,
  files: CommitFile[],
  commitMessage: string,
  branch: string = 'develop',
): Promise<CommitFilesResponse> {
  try {
    const response = await fetch(`${env.REPO_MANAGER_URL}/git/commit-files-by-repo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        repositoryName,
        files,
        commitMessage,
        branch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to commit files: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as any;

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('Error committing files to repository:', error);
    return {
      success: false,
    };
  }
}
