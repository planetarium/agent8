import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { logger } from '~/utils/logger';
import { type LoaderFunctionArgs } from '@remix-run/cloudflare';

export const loader = withV8AuthUser(commitDetailLoader);

/**
 * Loader function for getting commit details by hash
 */
async function commitDetailLoader({ context, request, params }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const commitHash = params.hash;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return Response.json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  if (!commitHash) {
    return Response.json({ success: false, message: 'Commit hash is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const commit = await gitlabService.getCommit(projectPath, commitHash);

    return Response.json({
      success: true,
      data: {
        commit,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch commit details:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return Response.json(
      { success: false, message: `Failed to fetch commit details: ${errorMessage}` },
      { status: 500 },
    );
  }
}
