import type { CreateRepositoryResponse, CommitFile, CommitFilesResponse } from './types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.createRepository');

export async function createRepository(
  env: Env,
  userAccessToken: string,
  repositoryName: string,
  description: string,
): Promise<CreateRepositoryResponse> {
  try {
    const response = await fetch(`${env.VITE_GITBASE_PERSISTENCE_URL}/git/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAccessToken}`,
      },
      body: JSON.stringify({
        projectName: repositoryName,
        description,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create repository: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return {
      success: true,
      data: result,
    } as CreateRepositoryResponse;
  } catch (error) {
    logger.error('Error creating repository:', error);
    return {
      success: false,
    };
  }
}

export async function commitFilesToRepo(
  env: Env,
  userAccessToken: string,
  repositoryName: string,
  files: CommitFile[],
  commitMessage: string,
  branch: string = 'main',
): Promise<CommitFilesResponse> {
  try {
    const response = await fetch(`${env.VITE_GITBASE_PERSISTENCE_URL}/git/commits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAccessToken}`,
      },
      body: JSON.stringify({
        projectName: repositoryName,
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
    logger.error('Error committing files to repository:', error);
    return {
      success: false,
    };
  }
}
