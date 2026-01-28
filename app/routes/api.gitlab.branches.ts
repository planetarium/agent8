import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

export const loader = withV8AuthUser(branchesLoader);

const logger = createScopedLogger('api.gitlab.branches');

/**
 * Loader function for getting project branches
 */
async function branchesLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return Response.json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const branches = await gitlabService.getProjectBranches(projectPath);

    return Response.json({
      success: true,
      data: {
        branches,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch project branches:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return Response.json(
      { success: false, message: `Failed to fetch project branches: ${errorMessage}` },
      { status: 500 },
    );
  }
}
