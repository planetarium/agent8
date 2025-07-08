import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';

export const loader = publicProjectLoader;

/**
 * Loader function for getting public project information without authentication
 */
async function publicProjectLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const gitlabService = new GitlabService(env);

  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');

  // Input validation
  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  // Basic projectPath validation (prevent injection attacks)
  if (!/^[\w\-\/\.]+$/.test(projectPath)) {
    return json({ success: false, message: 'Invalid project path format' }, { status: 400 });
  }

  try {
    // Get project information directly (this will fail for private projects)
    const project = await gitlabService.gitlab.Projects.show(projectPath);

    const projectData = project as any;

    // Only allow access to public projects
    if (projectData.visibility !== 'public') {
      return json(
        {
          success: false,
          message: 'Project not found or not accessible',
        },
        { status: 404 },
      );
    }

    return json({
      success: true,
      data: {
        id: projectData.id,
        name: projectData.name,
        path_with_namespace: projectData.path_with_namespace,
        description: projectData.description,
        visibility: projectData.visibility,
        default_branch: projectData.default_branch || 'develop',
      },
    });
  } catch {
    // Don't expose internal errors - just return generic message
    return json(
      {
        success: false,
        message: 'Project not found or not accessible',
      },
      { status: 404 },
    );
  }
}
