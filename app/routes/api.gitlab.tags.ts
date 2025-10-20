import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(tagsLoader);

/**
 * Loader function for getting project tags
 */
async function tagsLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const tags = await gitlabService.getTags(projectPath);

    return json({
      success: true,
      tags,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: errorMessage }, { status: 500 });
  }
}
