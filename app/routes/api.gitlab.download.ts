import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(downloadLoader, { checkCredit: true });

/**
 * Loader function for downloading code from a project
 */
async function downloadLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const commitSha = url.searchParams.get('commitSha') || undefined;

  if (!projectPath) {
    return new Response('Project path is required', { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    // Check project access permission
    const accessCheck = await gitlabService.checkProjectAccess(user.email, projectPath);

    if (!accessCheck.hasAccess) {
      return new Response(accessCheck.reason || 'Project not found', { status: 404 });
    }

    const archive = await gitlabService.downloadCode(projectPath, commitSha);

    // @ts-ignore TODO: fix this
    return new Response(archive, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="code.zip"`,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(`Failed to download code: ${errorMessage}`, { status: 500 });
  }
}
