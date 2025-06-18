import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(createTaskBranchAction);

const logger = createScopedLogger('api.gitlab.task-create-branch');

interface RequestBody {
  projectPath: string;
}

async function createTaskBranchAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (!context?.user) {
    return json({ success: false, message: 'Unauthorized: User not authenticated' }, { status: 401 });
  }

  const user = context.user as { email: string; isActivated: boolean };

  try {
    const { projectPath } = (await request.json()) as RequestBody;

    if (!projectPath) {
      return json({ success: false, message: 'Project path is required' }, { status: 400 });
    }

    const gitlabService = new GitlabService(env);

    // Verify the user owns this project
    const isOwner = await gitlabService.isProjectOwner(user.email, projectPath);

    if (!isOwner) {
      return json({ success: false, message: 'You do not have permission to access this project' }, { status: 403 });
    }

    // Get project info by extracting project name from path
    const projectName = projectPath.split('/').pop();

    if (!projectName) {
      return json({ success: false, message: 'Invalid project path' }, { status: 400 });
    }

    const gitlabUser = await gitlabService.getOrCreateUser(user.email);
    const project = await gitlabService.getProject(gitlabUser, projectName);
    const branch = 'task';

    // Check if branch exists, create if not
    let branchExists = false;

    try {
      await gitlabService.gitlab.Branches.show(project.id, branch);
      branchExists = true;
      logger.info(`Branch '${branch}' already exists`);
    } catch {
      branchExists = false;
    }

    if (!branchExists) {
      await gitlabService.gitlab.Branches.create(project.id, branch, 'main');
      logger.info(`Created branch: ${branch}`);
    }

    return json({
      success: true,
      data: {
        branchName: branch,
        existed: branchExists,
        projectPath: project.path_with_namespace,
      },
    });
  } catch (error: any) {
    logger.error('Failed to create task branch:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json(
      {
        success: false,
        message: `Failed to create task branch: ${errorMessage}`,
      },
      { status: 500 },
    );
  }
}
