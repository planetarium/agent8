import { Gitlab } from '@gitbeaker/rest';

import type {
  GitlabUser,
  GitlabProject,
  GitlabCommit,
  GitlabProtectedBranch,
  CommitAction,
  FileContent,
  GitlabIssue,
} from './types';
import axios from 'axios';
import { createScopedLogger } from '~/utils/logger';
import { isCommitHash } from './utils';

const logger = createScopedLogger('gitlabService');

interface GitlabDiff {
  old_path: string;
  new_path: string;
  a_mode: string;
  b_mode: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export class GitlabService {
  gitlab: InstanceType<typeof Gitlab>;
  gitlabUrl: string;
  gitlabToken: string;
  enabled: boolean;

  constructor(env: Env, temporaryMode: boolean = false) {
    this.gitlabUrl = env.GITLAB_URL || 'https://gitlab.verse8.io';
    this.gitlabToken = env.GITLAB_TOKEN;
    this.enabled = env.VITE_GITLAB_PERSISTENCE_ENABLED === 'true' && !temporaryMode;

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
          per_page: 1,
        },
      });

      const existingProjects = response.data as GitlabProject[];

      let finalProjectName = projectName;

      if (existingProjects.length > 0) {
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

      await this.gitlab.Branches.create(project.id, 'develop', 'main');

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
      try {
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
        throw new Error(`Branch '${branch}' does not exist`);
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

      if (branch && branch.startsWith('task-')) {
        const sinceTimestamp = branch.split('-')[1];
        params.since = new Date(parseInt(sinceTimestamp)).toISOString();
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

      let commitsData = commitsResponse.data as GitlabCommit[];

      // Filter commits to only include those with the branch name in the message for task branches
      if (branch && branch.startsWith('task-')) {
        commitsData = commitsData.filter((commit) => commit.message.includes(branch));
      }

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

  async getCommitDiff(projectPath: string, commitHash: string): Promise<GitlabDiff[]> {
    try {
      const response = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits/${commitHash}/diff`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );

      return response.data as GitlabDiff[];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get commit diff: ${errorMessage}`);
    }
  }

  async getTaskFirstCommit(projectPath: string, taskBranch: string): Promise<GitlabCommit> {
    try {
      const sinceTimestamp = taskBranch.split('-')[1];

      const commitsResponse = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params: {
            ref_name: taskBranch,
            per_page: 100,
            order: 'topo',
            since: new Date(parseInt(sinceTimestamp)).toISOString(),
            until: new Date(parseInt(sinceTimestamp) + 300_000).toISOString(),
          },
        },
      );
      const commits = commitsResponse.data as GitlabCommit[];

      const filtered = commits.filter((commit) => commit.message.includes(taskBranch));

      return filtered[filtered.length - 1];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get task first commit: ${errorMessage}`);
    }
  }

  async getTaskLastCommit(projectPath: string, taskBranch: string): Promise<GitlabCommit> {
    try {
      const sinceTimestamp = taskBranch.split('-')[1];

      const commitsResponse = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/commits`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params: {
            ref_name: taskBranch,
            per_page: 1,
            order: 'topo',
            since: new Date(parseInt(sinceTimestamp)).toISOString(),
          },
        },
      );
      const commits = commitsResponse.data as GitlabCommit[];

      const filtered = commits.filter((commit) => commit.message.includes(taskBranch));

      return filtered[0];
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get task first commit: ${errorMessage}`);
    }
  }

  async getTaskBranches(projectPath: string): Promise<{
    branches: {
      name: string;
      commit: {
        id: string;
        message: string;
        created_at: string;
        author_name: string;
      } | null;
      protected: boolean;
      merged: boolean;
      mergeRequestId?: number;
      mergeStatus?: string;
    }[];
  }> {
    try {
      const projectId = encodeURIComponent(projectPath);

      // Get both task- and issue- branches
      const [taskBranchesResponse, issueBranchesResponse] = await Promise.all([
        axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/repository/branches`, {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params: {
            search: 'task-',
            per_page: 100,
          },
        }),
        axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/repository/branches`, {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params: {
            search: 'issue-',
            per_page: 100,
          },
        }),
      ]);

      const branches = [...taskBranchesResponse.data, ...issueBranchesResponse.data];

      // Get merge requests for this project using gitlab-api
      const openMergeRequestsResponse = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${projectId}/merge_requests?state=opened`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
          params: {
            per_page: 100,
          },
        },
      );
      const openMergeRequests = openMergeRequestsResponse.data;

      // Check and refresh merge requests that need rechecking
      for (const mr of openMergeRequests) {
        if (mr.merge_status !== 'can_be_merged') {
          try {
            // Send refresh merge request status API call
            await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mr.iid}/merge_ref`, {
              headers: {
                'PRIVATE-TOKEN': this.gitlabToken,
              },
            });
          } catch (refreshError: any) {
            const errorMessage = refreshError instanceof Error ? refreshError.message : 'Unknown error';
            logger.warn(`Failed to refresh merge status for MR #${mr.iid}: ${errorMessage}`);
          }

          // Get updated status
          const updatedMR = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mr.iid}`, {
            headers: {
              'PRIVATE-TOKEN': this.gitlabToken,
            },
          });
          mr.merge_status = updatedMR.data.merge_status;
        }
      }

      // Create a map of source branch -> merge request for quick lookup
      const mergeRequestByBranch = openMergeRequests.reduce((acc: Record<string, any>, mr: any) => {
        acc[mr.source_branch] = {
          id: mr.iid,
          mergeStatus: mr.merge_status,
        };
        return acc;
      }, {});

      for (const branch of branches) {
        const firstCommit = await this.getTaskFirstCommit(projectPath, branch.name);
        const lastCommit = await this.getTaskLastCommit(projectPath, branch.name);

        branch.firstCommit = firstCommit;
        branch.lastCommit = lastCommit;

        // Add merge request info if exists
        if (mergeRequestByBranch[branch.name]) {
          branch.mergeRequestId = mergeRequestByBranch[branch.name].id;
          branch.mergeStatus = mergeRequestByBranch[branch.name].mergeStatus;
        } else if (firstCommit && lastCommit) {
          //check branch is exists
          try {
            await this.gitlab.Branches.show(projectPath, branch.name);

            const newMR = await this.createMergeRequest(projectPath, branch.name, 'develop');

            branch.mergeRequestId = newMR.mergeRequestId;
          } catch (error) {
            logger.error(error);
          }
        }
      }

      return {
        branches: branches.filter((branch: any) => branch?.mergeRequestId),
      };
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch task branches: ${errorMessage}`);
    }
  }

  async mergeTaskBranch(
    projectPath: string,
    fromBranch: string,
    toBranch: string = 'develop',
  ): Promise<{
    message: string;
    mergedBranch: string;
  }> {
    try {
      try {
        await this.gitlab.Branches.show(projectPath, fromBranch);
        await this.gitlab.Branches.show(projectPath, toBranch);
      } catch {
        throw new Error(`Branch does not exist`);
      }

      const mrs = await this.gitlab.MergeRequests.all({
        projectId: projectPath,
        sourceBranch: fromBranch,
        targetBranch: toBranch,
        state: 'opened',
      });

      if (mrs.length === 0) {
        throw new Error('No merge request found');
      }

      const mergeRequest = mrs[0];

      if (!mergeRequest.merge_status || mergeRequest.merge_status === 'cannot_be_merged') {
        throw new Error(`Branch cannot be merged automatically (status: ${mergeRequest.merge_status})`);
      }

      try {
        await this.gitlab.MergeRequests.accept(projectPath, mergeRequest.iid, {
          mergeWhenPipelineSucceeds: false,
          shouldRemoveSourceBranch: false,
        });

        await this.gitlab.Branches.remove(projectPath, fromBranch);
      } catch (error: any) {
        if (error.message.includes('Unprocessable Entity')) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await this.gitlab.MergeRequests.accept(projectPath, mergeRequest.iid, {
            mergeWhenPipelineSucceeds: false,
            shouldRemoveSourceBranch: false,
          });

          await this.gitlab.Branches.remove(projectPath, fromBranch);
        } else {
          throw new Error(`Failed to accept merge request: ${error.message}`);
        }
      }

      return {
        message: `Successfully merged ${fromBranch} into ${toBranch}`,
        mergedBranch: fromBranch,
      };
    } catch (error) {
      logger.error('Failed to merge branches:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to merge task branch: ${errorMessage}`);
    }
  }

  /**
   * Creates a new task branch with timestamp suffix and an initial merge request
   */
  async createTaskBranch(
    projectPath: string,
    baseRef: string = 'develop',
  ): Promise<{
    branchName: string;
    mergeRequestId: number;
  }> {
    try {
      const timestamp = Date.now();
      const branchName = `task-${timestamp}`;

      await this.gitlab.Branches.create(projectPath, branchName, baseRef);

      // If baseRef is not 'develop', move 'develop' branch to match the baseRef position
      if (baseRef !== 'develop') {
        try {
          // Check if develop branch exists
          try {
            await this.gitlab.Branches.show(projectPath, 'develop');

            // If it exists, delete and recreate it at the baseRef position
            await this.gitlab.Branches.remove(projectPath, 'develop');
          } catch {
            // If develop doesn't exist, that's fine - we'll create it
            logger.info(`Develop branch not found, will create it at ${baseRef}`);
          }

          // Create develop branch at the baseRef position
          await this.gitlab.Branches.create(projectPath, 'develop', baseRef);
          logger.info(`Moved 'develop' branch to match baseRef: ${baseRef}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error(`Failed to move 'develop' branch to match baseRef: ${errorMessage}`);
          throw error;
        }
      }

      const mergeRequest = await this.createMergeRequest(projectPath, branchName, 'develop');

      return {
        branchName,
        mergeRequestId: mergeRequest.mergeRequestId,
      };
    } catch (error: any) {
      logger.error('Failed to create task branch:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create task branch: ${errorMessage}`);
    }
  }

  async createMergeRequest(
    projectPath: string,
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{
    branchName: string;
    mergeRequestId: number;
  }> {
    try {
      const mergeRequest = await this.gitlab.MergeRequests.create(
        projectPath,
        sourceBranch,
        targetBranch,
        `Merge ${sourceBranch} into ${targetBranch}`,
        {
          removeSourceBranch: false,
          squash: false,
        },
      );
      return {
        branchName: sourceBranch,
        mergeRequestId: mergeRequest.iid,
      };
    } catch (error: any) {
      logger.warn(`Created branch but failed to create merge request: ${error.message}`);
      return {
        branchName: sourceBranch,
        mergeRequestId: 0,
      };
    }
  }

  /**
   * Renames a task branch by adding a 'removed-' prefix and closes associated merge requests
   */
  async removeTaskBranch(
    projectPath: string,
    branchName: string,
  ): Promise<{
    message: string;
    oldBranchName: string;
    newBranchName: string;
    closedMergeRequests?: number[];
  }> {
    try {
      // 1. Get project
      const project = await this.gitlab.Projects.show(projectPath);

      // 2. Check if branch exists
      try {
        await this.gitlab.Branches.show(project.id, branchName);
      } catch (error: any) {
        throw new Error(`Branch '${branchName}' does not exist: ${error.message}`);
      }

      // 3. Find and close any open merge requests associated with this branch
      const openMergeRequestsResponse = await axios.get(
        `${this.gitlabUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?state=opened`,
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
          },
        },
      );
      const mrs = openMergeRequestsResponse.data;

      const closedMergeRequests: number[] = [];

      if (mrs && mrs.length > 0) {
        for (const mr of mrs) {
          try {
            // Close the merge request
            await this.gitlab.MergeRequests.edit(project.id, mr.iid, {
              stateEvent: 'close',
            });
            closedMergeRequests.push(mr.iid);
            logger.info(`Closed merge request #${mr.iid}`);
          } catch (mrError: any) {
            logger.warn(`Failed to close merge request #${mr.iid}: ${mrError.message}`);
          }
        }
      }

      // 4. Generate new branch name with removed- prefix
      const newBranchName = `removed-${branchName}`;

      // 5. Create new branch from the old branch
      await this.gitlab.Branches.create(project.id, newBranchName, branchName);

      // 6. Delete the old branch
      await this.gitlab.Branches.remove(project.id, branchName);

      const result: {
        message: string;
        oldBranchName: string;
        newBranchName: string;
        closedMergeRequests?: number[];
      } = {
        message: `Successfully renamed branch '${branchName}' to '${newBranchName}'`,
        oldBranchName: branchName,
        newBranchName,
      };

      if (closedMergeRequests.length > 0) {
        result.closedMergeRequests = closedMergeRequests;
        result.message += ` and closed ${closedMergeRequests.length} merge request(s)`;
      }

      return result;
    } catch (error) {
      logger.error('Failed to remove task branch:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to remove task branch: ${errorMessage}`);
    }
  }

  /**
   * Reverts a specific branch to a given commit hash
   */
  async revertBranchToCommit(
    projectId: number | string,
    branchName: string,
    commitHash: string,
  ): Promise<{
    message: string;
    branchName: string;
    revertedToCommit: string;
    backupBranchName?: string;
  }> {
    try {
      // Check if project exists
      let project;

      try {
        project = await this.gitlab.Projects.show(projectId);
      } catch (projectError) {
        logger.error('Project not found:', projectError);
        throw new Error(`Project not found: ${projectId}`);
      }

      // Check if branch exists
      let branchExists = false;

      try {
        await this.gitlab.Branches.show(project.id, branchName);
        branchExists = true;
      } catch {
        branchExists = false;
      }

      if (!branchExists) {
        throw new Error(`Branch '${branchName}' does not exist`);
      }

      // Verify that the commit exists
      try {
        await this.getCommit(project.path_with_namespace as string, commitHash);
      } catch (commitError) {
        logger.error('Commit verification failed:', commitError);
        throw new Error(`Commit '${commitHash}' does not exist or is not accessible`);
      }

      // Create a backup branch in case something goes wrong
      const backupBranchName = `backup-${branchName}-${Date.now()}`;

      try {
        await this.gitlab.Branches.create(project.id, backupBranchName, branchName);
        logger.info(`Created backup branch: ${backupBranchName}`);
      } catch (backupError) {
        logger.error('Failed to create backup branch:', backupError);
        throw new Error(
          `Failed to create backup branch: ${backupError instanceof Error ? backupError.message : 'Unknown error'}`,
        );
      }

      // Revert the branch to the specified commit
      try {
        // Delete the existing branch
        await this.gitlab.Branches.remove(project.id, branchName);
        logger.info(`Deleted original branch: ${branchName}`);

        // Create a new branch pointing to the target commit
        await this.gitlab.Branches.create(project.id, branchName, commitHash);
        logger.info(`Created new branch '${branchName}' pointing to commit '${commitHash}'`);

        return {
          message: `Successfully reverted branch '${branchName}' to commit '${commitHash}'`,
          branchName,
          revertedToCommit: commitHash,
          backupBranchName,
        };
      } catch (revertError) {
        // If something went wrong, try to restore from backup
        logger.error('Error reverting branch:', revertError);

        try {
          // Try to restore the original branch from backup
          await this.gitlab.Branches.remove(project.id, branchName).catch(() => {
            // Ignore error if branch doesn't exist
          });
          await this.gitlab.Branches.create(project.id, branchName, backupBranchName);
          logger.info(`Restored branch '${branchName}' from backup`);
        } catch (restoreError) {
          logger.error('Failed to restore branch from backup:', restoreError);
          throw new Error(
            `Failed to revert branch and could not restore from backup. Backup branch '${backupBranchName}' is available for manual recovery.`,
          );
        }

        throw new Error(
          `Failed to revert branch: ${revertError instanceof Error ? revertError.message : 'Unknown error'}`,
        );
      }
    } catch (error) {
      logger.error('Failed to revert branch to commit:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to revert branch to commit: ${errorMessage}`);
    }
  }

  async getProjectIssues(
    projectPath: string,
    page: number = 1,
    perPage: number = 20,
    state: 'opened' | 'closed' | 'all' = 'opened',
    additionalLabel?: string,
  ): Promise<{
    issues: GitlabIssue[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const projectId = encodeURIComponent(projectPath);

      // Build labels parameter - always include agentic
      let labels = 'agentic';

      if (additionalLabel) {
        labels += `,${additionalLabel}`;
      }

      const response = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/issues`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          state,
          page,
          per_page: perPage,
          order_by: 'created_at',
          sort: 'asc', // Change to ascending order (oldest first)
          labels, // Use the constructed labels string
        },
      });

      const issues = response.data as GitlabIssue[];
      const totalIssues = parseInt(response.headers['x-total'] || '0', 10);
      const hasMore = page * perPage < totalIssues;

      return {
        issues,
        total: totalIssues,
        hasMore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get project issues: ${errorMessage}`);
    }
  }

  async getIssue(projectPath: string, issueIid: number): Promise<GitlabIssue> {
    try {
      const projectId = encodeURIComponent(projectPath);

      const response = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/issues/${issueIid}`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
      });

      return response.data as GitlabIssue;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get issue: ${errorMessage}`);
    }
  }

  async updateIssueLabels(projectPath: string, issueIid: number, labels: string[]): Promise<GitlabIssue> {
    try {
      const projectId = encodeURIComponent(projectPath);

      const response = await axios.put(
        `${this.gitlabUrl}/api/v4/projects/${projectId}/issues/${issueIid}`,
        {
          labels: labels.join(','),
        },
        {
          headers: {
            'PRIVATE-TOKEN': this.gitlabToken,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data as GitlabIssue;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to update issue labels: ${errorMessage}`);
    }
  }

  /**
   * Find branch associated with an issue
   * Looks for branches that contain the issue number in their name or merge requests that reference the issue
   */
  async getIssueBranch(projectPath: string, issueIid: number): Promise<string | null> {
    try {
      const projectId = encodeURIComponent(projectPath);

      // First, try to find branches that contain the issue number
      const branchesResponse = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/repository/branches`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          per_page: 100,
        },
      });

      const branches = branchesResponse.data;

      // Look for branches that contain the issue number
      const issueBranches = branches.filter((branch: any) => {
        const branchName = branch.name.toLowerCase();
        return (
          branchName.includes(`issue-${issueIid}`) ||
          branchName.includes(`${issueIid}-`) ||
          branchName.includes(`-${issueIid}`) ||
          branchName.includes(`#${issueIid}`)
        );
      });

      if (issueBranches.length > 0) {
        // Return the most recently created branch
        return issueBranches[0].name;
      }

      // If no branch found by name, look for merge requests that reference this issue
      const mergeRequestsResponse = await axios.get(`${this.gitlabUrl}/api/v4/projects/${projectId}/merge_requests`, {
        headers: {
          'PRIVATE-TOKEN': this.gitlabToken,
        },
        params: {
          state: 'opened',
          per_page: 100,
        },
      });

      const mergeRequests = mergeRequestsResponse.data;

      // Look for merge requests that mention this issue in title or description
      const issueMR = mergeRequests.find((mr: any) => {
        const title = mr.title.toLowerCase();
        const description = (mr.description || '').toLowerCase();

        return (
          title.includes(`#${issueIid}`) ||
          title.includes(`issue ${issueIid}`) ||
          description.includes(`#${issueIid}`) ||
          description.includes(`issue ${issueIid}`)
        );
      });

      if (issueMR) {
        return issueMR.source_branch;
      }

      return null;
    } catch (error) {
      logger.error('Failed to find issue branch:', error);
      return null;
    }
  }
}
