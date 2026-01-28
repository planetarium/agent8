import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(getVersionHistoryLoader);
export const action = withV8AuthUser(versionHistoryAction);

/**
 * GET /api/gitlab/version-history
 * Get version history for a project
 */
async function getVersionHistoryLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'projectPath is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);
    const versions = await gitlabService.getVersionHistory(projectPath);

    return json({ success: true, data: { versions } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return json({ success: false, message: errorMessage }, { status: 500 });
  }
}

/**
 * POST /api/gitlab/version-history
 * Save a new version
 *
 * DELETE /api/gitlab/version-history
 * Delete a specific version
 */
async function versionHistoryAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (request.method === 'POST') {
    // Save version
    try {
      const { projectPath, commitHash, commitTitle, title, description } = (await request.json()) as {
        projectPath: string;
        commitHash: string;
        commitTitle: string;
        title?: string;
        description?: string;
      };

      if (!projectPath || !commitHash || !commitTitle) {
        return json(
          {
            success: false,
            message: 'projectPath, commitHash, and commitTitle are required',
          },
          { status: 400 },
        );
      }

      const gitlabService = new GitlabService(env);
      await gitlabService.saveVersion(projectPath, commitHash, commitTitle, title, description);

      return json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return json({ success: false, message: errorMessage }, { status: 500 });
    }
  } else if (request.method === 'DELETE') {
    // Delete version
    try {
      const { projectPath, commitHash } = (await request.json()) as {
        projectPath: string;
        commitHash: string;
      };

      if (!projectPath || !commitHash) {
        return json(
          {
            success: false,
            message: 'projectPath and commitHash are required',
          },
          { status: 400 },
        );
      }

      const gitlabService = new GitlabService(env);
      await gitlabService.deleteVersion(projectPath, commitHash);

      return json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return json({ success: false, message: errorMessage }, { status: 500 });
    }
  }

  return json({ success: false, message: 'Method not allowed' }, { status: 405 });
}
