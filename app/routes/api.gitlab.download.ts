import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(downloadLoader, { checkCredit: true });

/**
 * Loader function for downloading code from a project
 */
export async function downloadLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const commitSha = url.searchParams.get('commitSha') || undefined;

  if (!projectPath) {
    return new Response('Project path is required', { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const archive = await gitlabService.downloadCode(projectPath, commitSha);

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
