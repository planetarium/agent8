import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(descriptionAction);

/**
 * Action function for updating project description
 */
async function descriptionAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  // JSON 데이터로 받기
  const requestData = (await request.json()) as {
    projectPath: string;
    description: string;
  };

  const projectPath = requestData.projectPath;
  const description = requestData.description;

  if (!projectPath) {
    return Response.json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const hasPermission = await gitlabService.isProjectOwner(user.email, projectPath);

    if (!hasPermission) {
      return Response.json(
        { success: false, message: 'You do not have permission to revert branches in this project' },
        { status: 403 },
      );
    }

    const updatedProject = await gitlabService.updateProjectDescription(user.email, projectPath, description);

    return Response.json({
      success: true,
      message: 'Project description updated successfully',
      data: {
        id: updatedProject.id,
        name: updatedProject.name,
        path_with_namespace: updatedProject.path_with_namespace,
        description: updatedProject.description,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return Response.json(
      { success: false, message: `Failed to update project description: ${errorMessage}` },
      { status: 500 },
    );
  }
}
