import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

// Create an instance of GitlabService

export const action = withV8AuthUser(projectsAction, { checkCredit: true });
export const loader = withV8AuthUser(projectsLoader, { checkCredit: true });

/**
 * Loader function for getting user projects
 */
async function projectsLoader({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const gitlabService = new GitlabService(env);

  if (!user) {
    return json({ success: false, message: 'Authentication required' }, { status: 401 });
  }

  const email = user.email;

  if (!email) {
    return json({ success: false, message: 'Email is required' }, { status: 400 });
  }

  const url = new URL(request.url);
  const page = url.searchParams.get('page') || '1';
  const perPage = url.searchParams.get('perPage') || '50';

  const parsedPage = parseInt(page, 10);
  const parsedPerPage = parseInt(perPage, 10);

  try {
    const result = await gitlabService.getUserProjects(email, parsedPage, parsedPerPage);

    return json({
      success: true,
      data: {
        projects: result.projects,
        pagination: {
          total: result.total,
          page: parsedPage,
          perPage: parsedPerPage,
          hasMore: result.hasMore,
          totalPages: Math.ceil(result.total / parsedPerPage),
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return json({ success: false, message: `Failed to fetch projects: ${errorMessage}` }, { status: 500 });
  }
}

/**
 * Action function for creating project or deleting project
 */
async function projectsAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  const gitlabService = new GitlabService(env);

  if (!user) {
    return json({ success: false, message: 'Authentication required' }, { status: 401 });
  }

  if (!user.isActivated) {
    return json({ success: false, message: 'User is not activated' }, { status: 403 });
  }

  const email = user.email;

  // Create a new project (POST method)
  if (request.method === 'POST') {
    try {
      const { projectName, description } = (await request.json()) as {
        projectName: string;
        description: string;
      };

      if (!projectName) {
        return json({ success: false, message: 'Project name is required' }, { status: 400 });
      }

      // Get or create GitLab user
      const gitlabUser = await gitlabService.getOrCreateUser(email);

      // Create project
      const project = await gitlabService.createProject(gitlabUser, projectName, description);

      return json({
        success: true,
        id: project.id,
        name: project.name,
        path: project.path_with_namespace,
        description: project.description,
        user: {
          id: gitlabUser.id,
          username: gitlabUser.username,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return json({ success: false, message: `Failed to create project: ${errorMessage}` }, { status: 500 });
    }
  }

  // Delete project (DELETE method)
  if (request.method === 'DELETE') {
    try {
      const url = new URL(request.url);
      const projectId = url.searchParams.get('projectId');

      if (!projectId) {
        return json({ success: false, message: 'Project ID is required' }, { status: 400 });
      }

      // Check permission
      const hasPermission = await gitlabService.isProjectOwner(email, projectId);

      if (!hasPermission) {
        return json({ success: false, message: 'You do not have permission to delete this project' }, { status: 403 });
      }

      // Delete project
      await gitlabService.deleteProject(projectId);

      return json({
        success: true,
        message: 'Project deleted successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return json({ success: false, message: `Failed to delete project: ${errorMessage}` }, { status: 500 });
    }
  }

  return json({ success: false, message: 'Invalid method' }, { status: 405 });
}
