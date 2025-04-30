import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(getDiffLoader, { checkCredit: true });

async function getDiffLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const commitHash = url.searchParams.get('commitHash');

  if (!projectPath || !commitHash) {
    return new Response('Project path and commit hash are required', { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const diff = await gitlabService.getCommitDiff(projectPath, commitHash);
    return json({ success: true, data: diff });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get commit diff: ${errorMessage}`);
  }
}
