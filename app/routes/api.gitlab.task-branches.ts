import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';

export const loader = withV8AuthUser(branchesLoader, { checkCredit: true });
export const action = withV8AuthUser(branchesAction, { checkCredit: true });

/**
 * Loader function for getting project branches with task- prefix
 */
async function branchesLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const result = await gitlabService.getTaskBranches(projectPath);

    return json({
      success: true,
      data: result.branches,
    });
  } catch (error) {
    logger.error('Failed to fetch project branches:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: `Failed to fetch project branches: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Action function for branch operations
 */
async function branchesAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  // Get request body as JSON
  const requestData = (await request.json()) as {
    projectPath: string;
    action: string;
    from?: string;
    to?: string;
    baseBranch?: string;
  };

  const { projectPath, action } = requestData;

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    if (action === 'merge') {
      const { from, to = 'develop' } = requestData;

      if (!from) {
        return json({ success: false, message: 'Source branch is required' }, { status: 400 });
      }

      const result = await gitlabService.mergeTaskBranch(projectPath, from, to);

      return json({
        success: true,
        data: result,
      });
    } else if (action === 'create') {
      const { baseBranch = 'develop' } = requestData;

      const result = await gitlabService.createTaskBranch(projectPath, baseBranch);

      return json({
        success: true,
        data: result,
      });
    } else {
      return json({ success: false, message: 'Unsupported action' }, { status: 400 });
    }
  } catch (error) {
    logger.error(`Failed to ${action} branches:`, error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json(
      {
        success: false,
        message: `Failed to ${action} branches: ${errorMessage}`,
      },
      { status: 500 },
    );
  }
}
