import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { commitFilesToRepo, createRepository } from '~/lib/repoManager/api';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.commit-changes');

export const action = withV8AuthUser(commitChangesAction, { checkCredit: true });

export async function commitChangesAction({ request, context }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const user = context?.user as { email: string; accessToken: string };
  const email = user?.email || '';
  const userAccessToken = user?.accessToken || '';

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { files, repositoryName, commitMessage } = (await request.json()) as {
      files: { path: string; content: string }[];
      repositoryName: string;
      commitMessage: string;
    };

    if (!files || !Array.isArray(files) || files.length === 0) {
      return json({ error: 'Files array is required and cannot be empty' }, { status: 400 });
    }

    // Validate files structure
    for (const file of files) {
      if (!file.path || typeof file.path !== 'string') {
        return json({ error: 'Each file must have a valid path property' }, { status: 400 });
      }

      if (file.content === undefined) {
        return json({ error: 'Each file must have a content property' }, { status: 400 });
      }
    }

    let finalRepositoryName = repositoryName;

    if (!finalRepositoryName) {
      const repository = await createRepository(env, userAccessToken, email, `verse8-project-${Date.now()}`, '');
      finalRepositoryName = repository.name;
    }

    // Commit the files to the repository
    const result = await commitFilesToRepo(
      env,
      userAccessToken,
      email,
      finalRepositoryName,
      files,
      commitMessage || 'Update files',
      'main',
    );

    if (!result.success) {
      return json(
        {
          success: false,
          error: 'Failed to commit changes to repository',
        },
        { status: 500 },
      );
    }

    return json({
      success: true,
      data: result.data,
      repositoryName: finalRepositoryName,
    });
  } catch (error) {
    logger.error('Error in commitChangesAction:', error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred',
      },
      { status: 500 },
    );
  }
}
