import { tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';
import path from 'path';
import { extractMarkdownFileNamesFromUnpkgHtml, fetchWithCache, resolvePackageVersion } from '~/lib/utils';

const logger = createScopedLogger('docs-tools');
const VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME = 'vibe-starter-3d-environment';
const vibeStarter3dEnvironmentDocs: Record<string, string> = {};

let loadedVibeStarter3dEnvironmentVersion: string | undefined = undefined;

interface DocTool {
  tool_name: string;
  description: string;
  response: string;
}

/**
 * Creates documentation tools by fetching from Supabase docs table
 * @param env Environment variables containing Supabase credentials
 * @returns An object with dynamically created tools
 */
export async function createDocTools(env: Env, files: any): Promise<Record<string, any>> {
  const isProduction = env.USE_PRODUCTION_VECTOR_DB === 'true';

  try {
    // Update vibe-starter-3d-environment docs
    await updateVibeLibrariesDocs(files);

    // Create Supabase client
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all documentation tools from the table
    const { data, error } = await supabase.from(isProduction ? 'docs_prod' : 'docs').select('*');

    if (error) {
      logger.error('Error fetching documentation tools:', error);
      return {};
    }

    if (!data || data.length === 0) {
      logger.warn('No documentation tools found in database');
      return {};
    }

    // Create a tools object with each tool from the database
    const tools: Record<string, any> = {};

    for (const doc of data as DocTool[]) {
      // Create a tool for each entry in the docs table
      const toolName = doc.tool_name.trim();

      if (toolName.match(/^[a-zA-Z_][a-zA-Z0-9_-]{1,63}$/)) {
        tools[toolName] = tool({
          description: doc.description,
          parameters: z.object({}), // No parameters needed as these are simple documentation responses
          execute: async () => {
            return { content: doc.response };
          },
        });
      }
    }

    if (loadedVibeStarter3dEnvironmentVersion) {
      const keysToRemove: string[] = [];
      const checkToolName = 'vibe_starter_3d_environment';
      Object.keys(tools).forEach((key) => {
        if (key.includes(checkToolName)) {
          logger.debug(`Found docTools key containing '${checkToolName}': ${key}`);

          if (vibeStarter3dEnvironmentDocs.hasOwnProperty(key)) {
            tools[key].execute = async () => {
              return { content: vibeStarter3dEnvironmentDocs[key] };
            };
          } else {
            keysToRemove.push(key);
          }
        }
      });

      keysToRemove.forEach((key) => {
        delete tools[key];
        logger.debug(
          `Removed docTools key '${key}' as it's not found in ${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME}:docs`,
        );
      });
    }

    return tools;
  } catch (error: any) {
    logger.error('Unexpected error creating documentation tools:', error);
    return {};
  }
}

async function updateVibeLibrariesDocs(files: any) {
  const version = await resolvePackageVersion(VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME, files);

  if (version === loadedVibeStarter3dEnvironmentVersion) {
    return;
  }

  try {
    Object.keys(vibeStarter3dEnvironmentDocs).forEach((key) => delete vibeStarter3dEnvironmentDocs[key]);

    const docsUrl = `https://app.unpkg.com/${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME}@${version}/files/docs`;

    const docsResponse = await fetchWithCache(docsUrl);
    const html = await docsResponse.text();

    const markdownFileNames = extractMarkdownFileNamesFromUnpkgHtml(html);

    for (const markdownFileName of markdownFileNames) {
      const markdownUrl = `https://unpkg.com/${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME}@${version}/docs/${markdownFileName}`;
      const markdownResponse = await fetchWithCache(markdownUrl);
      const markdown = await markdownResponse.text();
      const keyName = path.basename(markdownFileName, '.md');
      vibeStarter3dEnvironmentDocs[keyName] = markdown;
    }

    loadedVibeStarter3dEnvironmentVersion = version;
  } catch (error) {
    logger.error(`updateVibeLibrariesDocs: ${VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME} error: ${error}`);
    loadedVibeStarter3dEnvironmentVersion = undefined;
  }
}
