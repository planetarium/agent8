import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(getRestorePointLoader);
export const action = withV8AuthUser(restorePointAction);

/**
 * GET /api/gitlab/restore-point?projectPath=xxx&history=true
 * Get restore point or restore history for a project
 */
async function getRestorePointLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const getHistory = url.searchParams.get('history') === 'true';

  if (!projectPath) {
    return json({ success: false, message: 'projectPath is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);

    if (getHistory) {
      const history = await gitlabService.getRestoreHistory(projectPath);

      return json({
        success: true,
        data: {
          history,
        },
      });
    } else {
      const restorePoint = await gitlabService.getRestorePoint(projectPath);

      return json({
        success: true,
        data: {
          restorePoint,
        },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: errorMessage }, { status: 500 });
  }
}

/**
 * POST /api/gitlab/restore-point
 * Set or clear restore point for a project
 */
async function restorePointAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json(
      { success: false, message: 'Method not allowed' },
      {
        status: 405,
        headers: {
          Allow: 'POST, DELETE',
        },
      },
    );
  }

  const { projectPath, commitHash, commitTitle } = (await request.json()) as {
    projectPath: string;
    commitHash?: string;
    commitTitle?: string;
  };

  if (!projectPath) {
    return json({ success: false, message: 'projectPath is required' }, { status: 400 });
  }

  try {
    const gitlabService = new GitlabService(env);

    if (request.method === 'DELETE') {
      // Clear restore point
      await gitlabService.clearRestorePoint(projectPath);

      return json({
        success: true,
        message: 'Restore point cleared successfully',
      });
    } else {
      // Set restore point
      if (!commitHash) {
        return json({ success: false, message: 'commitHash is required for POST' }, { status: 400 });
      }

      if (!commitTitle) {
        return json({ success: false, message: 'commitTitle is required for POST' }, { status: 400 });
      }

      await gitlabService.setRestorePoint(projectPath, commitHash, commitTitle);

      return json({
        success: true,
        message: 'Restore point set successfully',
        data: {
          commitHash,
          commitTitle,
        },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: errorMessage }, { status: 500 });
  }
}
