import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { GitlabService } from '~/lib/persistenceGitbase/gitlabService';
import { withV8AuthUser } from '~/lib/verse8/middleware';
import { createScopedLogger } from '~/utils/logger';
import type { FileMap } from '~/lib/stores/files';

export const loader = withV8AuthUser(filesLoader, { checkCredit: true });

const logger = createScopedLogger('api.gitlab.files');

// Extend Env type to ensure it includes GITLAB_ACCESS_TOKEN
declare global {
  interface Env {
    GITLAB_URL: string;
    GITLAB_ACCESS_TOKEN: string;
  }
}

/**
 * Get README.md and PROJECT.md files from the project
 */
async function filesLoader({ context, request }: LoaderFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const url = new URL(request.url);
  const projectPath = url.searchParams.get('projectPath');
  const branch = 'develop';

  if (!projectPath) {
    return Response.json({ success: false, error: 'Project path cannot be empty' }, { status: 400 });
  }

  const gitlabService = new GitlabService(env);

  try {
    // Get project information
    const project = await gitlabService.findProject(projectPath.split('/')[0], projectPath.split('/')[1]);

    if (!project) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    logger.info(`Getting files for project ${projectPath} (ID: ${project.id})`);

    // Key files to retrieve
    const keyFiles = ['README.md', 'PROJECT.md'];
    const fileMap: FileMap = {};

    // Get file contents
    for (const fileName of keyFiles) {
      try {
        // Use GitlabService's getFileContent method to get file content
        const content = await gitlabService.getFileContent(project.id, fileName, branch);

        fileMap[fileName] = {
          content,
          type: 'file',
          isBinary: false,
        };

        logger.info(`Successfully retrieved file: ${fileName}`);
      } catch (e) {
        // Ignore errors for files that don't exist
        logger.warn(`Failed to retrieve file ${fileName}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    // Return result
    return Response.json({
      success: true,
      files: fileMap,
      projectInfo: {
        id: project.id,
        name: project.name,
        path: project.path_with_namespace,
        description: project.description,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to retrieve files: ${errorMessage}`);

    return Response.json({
      success: false,
      error: `Failed to retrieve files: ${errorMessage}`,
      files: {},
      projectInfo: null,
    });
  }
}
