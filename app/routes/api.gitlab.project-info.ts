import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(projectInfoLoader, { checkCredit: false });

/**
 * Loader function for getting project information
 */
async function projectInfoLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const gitlabService = new GitlabService(env);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  try {
    // Get project information
    const project = await gitlabService.gitlab.Projects.show(projectPath);

    // Get the latest commit from the default branch (usually develop)
    const defaultBranch = (project as any).default_branch || 'develop';
    const commits = await gitlabService.gitlab.Commits.all(projectPath, {
      refName: defaultBranch,
      perPage: 1,
    });

    const latestCommit = commits.length > 0 ? commits[0] : null;

    return json({
      success: true,
      data: {
        id: (project as any).id,
        name: (project as any).name,
        path_with_namespace: (project as any).path_with_namespace,
        description: (project as any).description,
        visibility: (project as any).visibility,
        default_branch: defaultBranch,
        latest_commit: latestCommit
          ? {
              id: latestCommit.id,
              message: latestCommit.message,
              created_at: latestCommit.created_at,
              author_name: latestCommit.author_name,
            }
          : null,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: `Failed to get project information: ${errorMessage}` }, { status: 500 });
  }
}
