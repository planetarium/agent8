import { Gitlab } from '@gitbeaker/rest';

import type {
  GitlabUser,
  GitlabProject,
  GitlabCommit,
  GitlabProtectedBranch,
  CommitAction,
  FileContent,
} from './types';
import axios from 'axios';
import { createScopedLogger } from '~/utils/logger';
import { isCommitHash } from './utils';

const logger = createScopedLogger('gitlabService');

export class GitlabService {
  gitlab: InstanceType<typeof Gitlab>;
  gitlabUrl: string;
  gitlabToken: string;
  enabled: boolean;

  constructor(env: Env) {
    this.gitlabUrl = env.GITLAB_URL || 'https://gitlab.verse8.io';
    this.gitlabToken = env.GITLAB_TOKEN;
    this.enabled = env.VITE_GITLAB_PERSISTENCE_ENABLED === 'true';

    if (!this.gitlabToken) {
      logger.warn('GITLAB_TOKEN is not set. GitLab API calls may fail.');
    }

    this.gitlab = new Gitlab({
      host: this.gitlabUrl,
      token: this.gitlabToken,
    });
  }

  async getOrCreateUser(email: string): Promise<GitlabUser> {
    try {
      const users = await this.gitlab.Users.all({
        search: email,
      });

      const existingUser = users.find((user: any) => user.email?.toLowerCase() === email.toLowerCase());

      if (existingUser) {
        return existingUser as unknown as GitlabUser;
      }

      const baseUsername = email.split('@')[0];

      const usernameCheck = await this.gitlab.Users.all({
        search: baseUsername,
      });

      let username = baseUsername;
      let usernameAvailable = false;

      const exactNameMatch = usernameCheck.some((user: any) => {
        const userName = (user.username || '').toLowerCase();
        return userName === baseUsername.toLowerCase();
      });

      if (exactNameMatch) {
        for (let i = 1; i <= 9; i++) {
          const tempUsername = `${baseUsername}${i}`;

          const nameExists = usernameCheck.some((user: any) => {
            const userName = (user.username || '').toLowerCase();
            return userName === tempUsername.toLowerCase();
          });

          if (!nameExists) {
            username = tempUsername;
            usernameAvailable = true;
            break;
          }
        }

        if (!usernameAvailable) {
          const timestamp = Date.now();
          username = `${baseUsername}_${timestamp}`;
        }
      }

      const newUser = await this.gitlab.Users.create({
        email,
        username,
        password: this._generateRandomPassword(),
        name: username,
        skipConfirmation: true,
      });

      return newUser as unknown as GitlabUser;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create or find user: ${errorMessage}`);
    }
  }

  async getProject(user: GitlabUser, projectName: string): Promise<GitlabProject> {
    try {
      const response = await axios.get(`${this.gitlabUrl}/api/v4/users/${user.id}/projects`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          owned: true,
          search: projectName,
          per_page: 100,
        },
      });

      const projects = response.data as GitlabProject[];

      const project = projects.find((p: any) => p.name.toLowerCase() === projectName.toLowerCase());

      if (!project) {
        throw new Error(`Not Found Project '${projectName}'`);
      }

      return {
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        default_branch: project.default_branch,
        created_at: project.created_at,
        updated_at: project.updated_at,
        description: project.description,
        visibility: project.visibility,
      } as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get or create project: ${errorMessage}`);
    }
  }

  async createProject(user: GitlabUser, projectName: string, description?: string): Promise<GitlabProject> {
    try {
      const response = await axios.get(`${this.gitlabUrl}/api/v4/users/${user.id}/projects`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          owned: true,
          search: projectName,
          per_page: 100,
        },
      });

      const existingProjects = response.data as GitlabProject[];

      let finalProjectName = projectName;

      const exactMatch = existingProjects.find((p: any) => p.name?.toLowerCase() === projectName.toLowerCase());

      if (exactMatch) {
        const timestamp = new Date().getTime();
        finalProjectName = `${projectName}-${timestamp}`;
      }

      const project = await this.gitlab.Projects.create({
        name: finalProjectName,
        namespaceId: user.namespace_id,
        visibility: 'private',
        initializeWithReadme: false,
        description: description || `${finalProjectName}`,
      });

      return project as unknown as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create project: ${errorMessage}`);
    }
  }

  async commitFiles(
    projectId: number,
    files: FileContent[],
    commitMessage: string,
    branch: string = 'develop',
    baseCommit?: string,
  ): Promise<GitlabCommit> {
    try {
      let defaultBranchName = '';

      try {
        const project = await this.gitlab.Projects.show(projectId);
        defaultBranchName = (project.default_branch as string) || '';

        const protectedBranches = (await this.gitlab.ProtectedBranches.all(projectId)) as GitlabProtectedBranch[];
        const isProtected = protectedBranches.some((pb) => pb.name === branch);

        if (isProtected) {
          const tempBranch = `temp-${Date.now()}`;
          await this.gitlab.Branches.create(projectId, tempBranch, branch);
          branch = tempBranch;
        }
      } catch (projectError) {
        logger.error('Project not found:', projectError);
        throw new Error(`Project not found: ${projectId}`);
      }

      let branchExists = false;

      try {
        await this.gitlab.Branches.show(projectId, branch);
        branchExists = true;
      } catch {
        branchExists = false;
      }

      if (!branchExists) {
        if (defaultBranchName) {
          await this.gitlab.Branches.create(projectId, branch, defaultBranchName);
          branchExists = true;
        }

        if (!branchExists) {
          try {
            const initialActions: CommitAction[] = [
              {
                action: 'create' as const,
                filePath: 'README.md',
                content: `# Project ${projectId}\n\nThis is a new project.`,
              },
            ];

            await this.gitlab.Commits.create(projectId, branch, 'Initial Commit', initialActions);
            branchExists = true;
          } catch (initialCommitError) {
            logger.error('Initial commit failed:', initialCommitError);
            throw new Error(`Cannot create initial commit to branch: ${branch}`);
          }
        }
      }

      // If baseCommit is provided, reset the branch to that commit
      if (baseCommit) {
        try {
          // Create a backup branch in case something goes wrong
          const backupBranch = `backup-${branch}-${Date.now()}`;
          await this.gitlab.Branches.create(projectId, backupBranch, branch);

          // Delete and recreate the branch at the specific commit
          try {
            // Delete the branch
            await this.gitlab.Branches.remove(projectId, branch);

            // Create a new branch pointing to the baseCommit
            await this.gitlab.Branches.create(projectId, branch, baseCommit);

            logger.info(`Reset branch ${branch} to commit ${baseCommit}`);
          } catch (resetError) {
            // If something went wrong, restore from backup
            logger.error('Error resetting branch to commit:', resetError);

            try {
              // Try to restore from backup
              await this.gitlab.Branches.remove(projectId, branch);
              await this.gitlab.Branches.create(projectId, branch, backupBranch);
            } catch (restoreError) {
              logger.error('Failed to restore branch from backup:', restoreError);
            }

            throw new Error(
              `Failed to reset branch to commit: ${resetError instanceof Error ? resetError.message : 'Unknown error'}`,
            );
          }
        } catch (baseCommitError) {
          logger.error('Failed to reset branch to base commit:', baseCommitError);
          throw new Error(
            `Failed to reset branch to base commit: ${baseCommitError instanceof Error ? baseCommitError.message : 'Unknown error'}`,
          );
        }
      }

      const existingFiles = await this._getProjectFiles(projectId, branch);

      const actions: CommitAction[] = [];

      for (const file of files) {
        const fileExists = existingFiles.includes(file.path);
        const action: CommitAction = {
          action: fileExists ? ('update' as const) : ('create' as const),
          filePath: file.path,
          content: file.content,
        };
        actions.push(action);
      }

      let result;

      try {
        result = await this.gitlab.Commits.create(projectId, branch, commitMessage, actions);
      } catch (commitError: any) {
        const responseStatus =
          typeof commitError === 'object' &&
          commitError !== null &&
          typeof commitError.cause === 'object' &&
          commitError.cause !== null &&
          typeof commitError.cause.response === 'object' &&
          commitError.cause.response !== null
            ? commitError.cause.response.status
            : null;

        if (responseStatus === 403) {
          try {
            for (const file of files) {
              try {
                if (existingFiles.includes(file.path)) {
                  await this.gitlab.RepositoryFiles.edit(
                    projectId,
                    file.path,
                    branch,
                    file.content,
                    `${commitMessage}: ${file.path}`,
                  );
                } else {
                  await this.gitlab.RepositoryFiles.create(
                    projectId,
                    file.path,
                    branch,
                    file.content,
                    `${commitMessage}: ${file.path}`,
                  );
                }
              } catch (fileError) {
                logger.error(`Failed to save file: ${file.path}`, fileError);
              }
            }

            const lastCommit = await this._getLastCommit(projectId, branch);
            result = lastCommit;
          } catch (individualError) {
            logger.error('Failed to commit files:', individualError);

            const safeCommitError = typeof commitError === 'object' && commitError !== null ? commitError : {};
            const statusText =
              typeof safeCommitError.response === 'object' && safeCommitError.response !== null
                ? safeCommitError.response.statusText
                : null;
            const message = typeof safeCommitError.message === 'string' ? safeCommitError.message : null;

            const errorMessage = statusText || message || 'Forbidden';
            throw new Error(errorMessage);
          }
        } else {
          throw commitError;
        }
      }

      return result as unknown as GitlabCommit;
    } catch (error) {
      logger.error(error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to commit files: ${errorMessage}`);
    }
  }

  private async _getLastCommit(projectId: number, branch: string = 'develop'): Promise<GitlabCommit> {
    try {
      const commits = await this.gitlab.Commits.all(projectId, {
        refName: branch,
        perPage: 1,
      });

      if (commits && commits.length > 0) {
        return commits[0] as unknown as GitlabCommit;
      }

      return {} as GitlabCommit;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get last commit: ${errorMessage}`);
    }
  }

  private async _getProjectFiles(projectId: number, branch: string = 'develop'): Promise<string[]> {
    try {
      const response = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/repository/tree`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          recursive: true,
          ref: branch,
          per_page: 100,
        },
      });

      interface TreeItem {
        path: string;
        type: string;
      }

      const files = (response.data as TreeItem[]).filter((item) => item.type === 'blob').map((item) => item.path);

      return files;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get project files: ${errorMessage}`);
    }
  }

  async downloadCode(projectPath: string, commitSha?: string): Promise<Buffer> {
    try {
      const ref = commitSha || 'develop';

      const project = await this.gitlab.Projects.show(projectPath);

      const response = await axios({
        method: 'GET',
        url: `${this.gitlabUrl}/api/v4/projects/${project.id}/repository/archive.zip`,
        params: { sha: ref },
        responseType: 'arraybuffer',
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
      });

      if (response.status !== 200) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      return Buffer.from(response.data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to download code: ${errorMessage}`);
    }
  }

  private _generateRandomPassword(): string {
    const length = 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';

    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return password;
  }

  async findProject(username: string, projectName: string): Promise<GitlabProject> {
    try {
      const projectPath = `${username}/${projectName}`;
      const project = await this.gitlab.Projects.show(projectPath);

      return project as unknown as GitlabProject;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to find project: ${errorMessage}`);
    }
  }

  async getUserProjects(
    email: string,
    page: number = 1,
    perPage: number = 10,
  ): Promise<{
    projects: GitlabProject[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const user = await this.getOrCreateUser(email);

      const projectsResponse = await axios.get(`${this.gitlabUrl}/api/v4/users/${user.id}/projects`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          membership: true,
          order_by: 'updated_at',
          sort: 'desc',
          page,
          per_page: perPage,
          statistics: true,
        },
      });

      const projects = projectsResponse.data as GitlabProject[];
      const totalProjects = parseInt(projectsResponse.headers['x-total'] || '0', 10);
      const hasMore = page * perPage < totalProjects;

      const enhancedProjects = await Promise.all(
        projects.map(async (project: GitlabProject) => {
          try {
            const commitsResponse = await axios.get(
              `${this.gitlabUrl}/api/v4/projects/${project.id}/repository/commits`,
              {
                headers: {
                  'PRIVATE-TOKEN': this.gitlabToken,
                },
                params: {
                  ref_name: project.default_branch || 'develop',
                  per_page: 1,
                },
              },
            );

            const lastCommits = commitsResponse.data as GitlabCommit[];
            const lastCommit = lastCommits.length > 0 ? lastCommits[0] : null;

            return {
              id: project.id,
              name: project.name,
              path_with_namespace: project.path_with_namespace,
              default_branch: project.default_branch,
              description: project.description,
              visibility: project.visibility,
              created_at: project.created_at,
              updated_at: project.updated_at,
              last_commit: lastCommit
                ? {
                    id: lastCommit.id,
                    message: lastCommit.message,
                    created_at: lastCommit.created_at,
                    author_name: lastCommit.author_name,
                  }
                : null,
            } as GitlabProject;
          } catch (error) {
            logger.error(`Error loading commit:`, error);
            return {
              id: project.id,
              name: project.name,
              path_with_namespace: project.path_with_namespace,
              default_branch: project.default_branch,
              description: project.description,
              visibility: project.visibility,
              created_at: project.created_at,
              updated_at: project.updated_at,
              last_commit: null,
            } as GitlabProject;
          }
        }),
      );

      return {
        projects: enhancedProjects,
        total: totalProjects,
        hasMore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch user projects: ${errorMessage}`);
    }
  }

  async getCommit(projectPath: string, commitHash: string): Promise<GitlabCommit> {
    try {
      const response = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits/${commitHash}`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      return response.data as GitlabCommit;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get commit: ${errorMessage}`);
    }
  }

  async getProjectCommits(
    projectPath: string,
    page: number = 1,
    perPage: number = 20,
    branch?: string,
    untilCommit?: string,
  ): Promise<{
    project: {
      id: number;
      name: string;
      description: string;
    };
    commits: GitlabCommit[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const project = await this.gitlab.Projects.show(projectPath);

      const refName = branch || 'develop';

      const params: Record<string, any> = {
        ref_name: refName,
        page,
        per_page: perPage,
        order_by: 'created_at',
        sort: 'desc',
      };

      if (untilCommit && isCommitHash(untilCommit)) {
        try {
          const commit = await this.getCommit(projectPath, untilCommit);

          if (commit && commit.committed_date) {
            params.until = commit.committed_date;
          }
        } catch (commitError) {
          logger.error('Error fetching commit for untilCommit parameter:', commitError);
        }
      }

      const commitsResponse = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params,
        },
      );

      const totalCommits = parseInt(commitsResponse.headers['x-total'] || '0', 10);
      const hasMore = page * perPage < totalCommits;

      const commitsData = commitsResponse.data as GitlabCommit[];
      const commits = commitsData.map((commit) => ({
        id: commit.id,
        short_id: commit.short_id,
        title: commit.title,
        message: commit.message,
        author_name: commit.author_name,
        author_email: commit.author_email,
        created_at: commit.created_at,
        committed_date: commit.committed_date,
        stats: commit.stats,
      })) as GitlabCommit[];

      return {
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
        },
        commits,
        total: totalCommits,
        hasMore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch project commits: ${errorMessage}`);
    }
  }

  async deleteProject(projectId: number | string): Promise<boolean> {
    try {
      await this.gitlab.Projects.remove(projectId);

      return true;
    } catch (error) {
      logger.error(error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to delete project: ${errorMessage}`);
    }
  }

  async isProjectOwner(email: string, projectId: number | string): Promise<boolean> {
    try {
      const user = await this.getOrCreateUser(email);
      let project;

      try {
        project = await this.gitlab.Projects.show(projectId);
      } catch (projectError) {
        logger.error(`Error loading project:`, projectError);
        return false;
      }

      try {
        const currentUserResponse = await axios.get(`${this.gitlabUrl}/api/v4/user`, {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        });

        const currentUser = currentUserResponse.data as GitlabUser;

        if (currentUser && currentUser.is_admin) {
          return true;
        }
      } catch (adminCheckError) {
        logger.error(adminCheckError);
      }

      if (project.namespace && user.namespace_id) {
        const projectNamespaceId = project.namespace.id;
        const userNamespaceId = user.namespace_id;

        if (projectNamespaceId === userNamespaceId) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(error);

      return false;
    }
  }

  async updateProjectDescription(email: string, projectPath: string, description: string): Promise<GitlabProject> {
    try {
      const project = await this.gitlab.Projects.show(projectPath);

      const hasPermission = await this.isProjectOwner(email, project.id);

      if (!hasPermission) {
        throw new Error('You do not have permission to update this project');
      }

      const updatedProject = await this.gitlab.Projects.edit(project.id, {
        description,
      });

      return {
        id: project.id,
        name: project.name,
        path_with_namespace: project.path_with_namespace,
        description: updatedProject.description,
        default_branch: project.default_branch,
        created_at: project.created_at,
        updated_at: project.updated_at,
        visibility: project.visibility,
      } as GitlabProject;
    } catch (error) {
      logger.error(error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to update project description: ${errorMessage}`);
    }
  }
}
