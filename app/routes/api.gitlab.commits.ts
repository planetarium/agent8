import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import type { GitlabProject } from '~/lib/persistenceGitbase/types';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

export const action = withV8AuthUser(commitsAction);
export const loader = withV8AuthUser(commitsLoader);

const logger = createScopedLogger('api.gitlab.commits');

/**
 * Loader function for getting project commits
 */
async function commitsLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const page = url.searchParams.get('page') || '1';
  const perPage = url.searchParams.get('perPage') || '10';
  const branch = url.searchParams.get('branch') || '';
  const untilCommit = url.searchParams.get('untilCommit') || '';
  const all = url.searchParams.get('all') === 'true';

  if (!projectPath) {
    return Response.json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const parsedPage = parseInt(page, 10);
  const parsedPerPage = parseInt(perPage, 10);

  // Use undefined for empty branch parameter
  const branchToUse = branch === '' ? undefined : branch;

  const gitlabService = new GitlabService(env);

  try {
    // Check project access permission
    const accessCheck = await gitlabService.checkProjectAccess(user.email, projectPath);

    if (!accessCheck.hasAccess) {
      return Response.json({ success: false, message: accessCheck.reason || 'Project not found' }, { status: 404 });
    }

    const result = await gitlabService.getProjectCommits(
      projectPath,
      parsedPage,
      parsedPerPage,
      branchToUse,
      untilCommit,
      all,
    );

    return Response.json({
      success: true,
      data: {
        project: result.project,
        commits: result.commits,
        pagination: {
          total: result.total,
          page: parsedPage,
          perPage: parsedPerPage,
          hasMore: result.hasMore,
          totalPages: Math.ceil(result.total / parsedPerPage),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to fetch project commits:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return Response.json(
      { success: false, message: `Failed to fetch project commits: ${errorMessage}` },
      { status: 500 },
    );
  }
}

/**
 * Action function for committing files to project
 */
async function commitsAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };
  const email = user.email;

  if (!email) {
    return Response.json({ success: false, message: 'User email is required' }, { status: 401 });
  }

  // JSON 데이터로 받기
  const requestData = (await request.json()) as {
    projectName: string;
    isFirstCommit: boolean;
    description?: string;
    commitMessage: string;
    baseCommit?: string;
    branch?: string;
    files: {
      path: string;
      content: string;
    }[];
    deletedFiles?: string[];
  };
  const projectName = requestData.projectName;
  const isFirstCommit = requestData.isFirstCommit;
  const description = requestData.description;
  const commitMessage = requestData.commitMessage;
  const branch = requestData.branch || 'develop';
  const baseCommit = requestData.baseCommit;
  const files = requestData.files;
  const deletedFiles = requestData.deletedFiles;

  if (!projectName && !isFirstCommit) {
    return Response.json({ success: false, message: 'Project name is required' }, { status: 400 });
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return Response.json({ success: false, message: 'Files are required' }, { status: 400 });
  }

  if (files.find((file) => file.path === '.secret')) {
    return Response.json({ success: false, message: 'Secret file is not allowed' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    // Get or create GitLab user
    const gitlabUser = await gitlabService.getOrCreateUser(email);

    let project: GitlabProject;

    if (isFirstCommit) {
      project = await gitlabService.createProject(gitlabUser, projectName || 'untitled', description || 'untitled');
    } else {
      project = await gitlabService.getProject(gitlabUser, projectName);
    }

    logger.info('project', JSON.stringify(project));

    // Commit files
    const commit = await gitlabService.commitFiles(project.id, files, commitMessage, branch, baseCommit, deletedFiles);

    return Response.json({
      success: true,
      data: {
        commitHash: commit.id,
        message: commit.message,
        timestamp: commit.created_at,
        project: {
          id: project.id,
          name: project.name,
          path: project.path_with_namespace,
          description: project.description,
          created_at: project.created_at,
        },
        user: {
          id: gitlabUser.id,
          username: gitlabUser.username,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ success: false, message: `Failed to commit files: ${errorMessage}` }, { status: 500 });
  }
}
