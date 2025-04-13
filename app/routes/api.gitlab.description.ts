import { type ActionFunctionArgs, json } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';

export const action = withV8AuthUser(descriptionAction, { checkCredit: true });

/**
 * Action function for updating project description
 */
export async function descriptionAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; isActivated: boolean };

  if (!user) {
    return json({ success: false, message: 'Authentication required' }, { status: 401 });
  }

  if (!user.isActivated) {
    return json({ success: false, message: 'User is not activated' }, { status: 403 });
  }

  const email = user.email;

  // JSON 데이터로 받기
  const requestData = (await request.json()) as {
    projectPath: string;
    description: string;
  };

  const projectPath = requestData.projectPath;
  const description = requestData.description;

  if (!projectPath) {
    return json({ success: false, message: 'Project path is required' }, { status: 400 });
  }

  if (!email) {
    return json({ success: false, message: 'User email is required' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    const updatedProject = await gitlabService.updateProjectDescription(email, projectPath, description);

    return json({
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
    return json({ success: false, message: `Failed to update project description: ${errorMessage}` }, { status: 500 });
  }
}
