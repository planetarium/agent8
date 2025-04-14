import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import type { GitlabProject } from '~/lib/persistenceGitbase/types';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';

export const action = withV8AuthUser(commitsAction, { checkCredit: true });
export const loader = withV8AuthUser(commitsLoader, { checkCredit: true });

/**
 * Loader function for getting project commits
 */
async function commitsLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const page = url.searchParams.get('page') || '1';
  const perPage = url.searchParams.get('perPage') || '10';
  const branch = url.searchParams.get('branch') || '';
  const untilCommit = url.searchParams.get('untilCommit') || '';

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const parsedPage = parseInt(page, 10);
  const parsedPerPage = parseInt(perPage, 10);

  // Use undefined for empty branch parameter
  const branchToUse = branch === '' ? undefined : branch;

  const gitlabService = new GitlabService(env);

  try {
    const result = await gitlabService.getProjectCommits(
      projectPath,
      parsedPage,
      parsedPerPage,
      branchToUse,
      untilCommit,
    );

    return json({
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

    return json({ success: false, message: `Failed to fetch project commits: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Action function for committing files to project
 */
async function commitsAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const gitlabService = new GitlabService(env);

  if (!user) {
    return json({ success: false, message: 'Authentication required' }, { status: 401 });
  }

  if (!user.isActivated) {
    return json({ success: false, message: 'User is not activated' }, { status: 403 });
  }

  const email = user.email;

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
  };
  const projectName = requestData.projectName;
  const isFirstCommit = requestData.isFirstCommit;
  const description = requestData.description;
  const commitMessage = requestData.commitMessage;
  const branch = requestData.branch || 'develop';
  const baseCommit = requestData.baseCommit;
  const files = requestData.files;

  if (!projectName && !isFirstCommit) {
    return json({ success: false, message: 'Project name is required' }, { status: 400 });
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return json({ success: false, message: 'Files are required' }, { status: 400 });
  }

  try {
    // Get or create GitLab user
    const gitlabUser = await gitlabService.getOrCreateUser(email);

    let project: GitlabProject;

    if (isFirstCommit) {
      project = await gitlabService.createProject(gitlabUser, projectName || 'untitled', description || 'untitled');
    } else {
      project = await gitlabService.getProject(gitlabUser, projectName);
    }

    logger.info('project', project);

    // Commit files
    const commit = await gitlabService.commitFiles(project.id, files, commitMessage, branch, baseCommit);

    return json({
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
        },
        user: {
          id: gitlabUser.id,
          username: gitlabUser.username,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: `Failed to commit files: ${errorMessage}` }, { status: 500 });
  }
}
