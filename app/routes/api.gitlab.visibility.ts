import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(visibilityAction, { checkCredit: true });
export const loader = withV8AuthUser(visibilityLoader, { checkCredit: true });

/**
 * Loader function for getting project visibility
 */
async function visibilityLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const gitlabService = new GitlabService(env);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  try {
    const visibility = await gitlabService.getProjectVisibility(projectPath);

    return json({
      success: true,
      data: {
        visibility,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: `Failed to get project visibility: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Action function for updating project visibility
 */
async function visibilityAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };
  const gitlabService = new GitlabService(env);

  if (request.method === 'PATCH') {
    try {
      const { projectPath, visibility } = (await request.json()) as {
        projectPath: string;
        visibility: 'public' | 'private';
      };

      if (!projectPath) {
        return json({ success: false, message: 'Project path is required' }, { status: 400 });
      }

      if (!visibility || !['public', 'private'].includes(visibility)) {
        return json({ success: false, message: 'Valid visibility (public/private) is required' }, { status: 400 });
      }

      const project = await gitlabService.updateProjectVisibility(user.email, projectPath, visibility);

      return json({
        success: true,
        data: {
          visibility: project.visibility,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return json({ success: false, message: `Failed to update project visibility: ${errorMessage}` }, { status: 500 });
    }
  }

  return json(
    { success: false, message: 'Invalid method' },
    {
      status: 405,
      headers: {
        Allow: 'GET, PATCH',
      },
    },
  );
}
