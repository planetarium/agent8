import { tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';
import path from 'path';
import { extractMarkdownFileNamesFromUnpkgHtml, fetchWithCache, resolvePackageVersion } from '~/lib/utils';

const logger = createScopedLogger('docs-tools');
const VIBE_STARTER_3D_PACKAGE_NAME = 'vibe-starter-3d';
const VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME = 'vibe-starter-3d-environment';
const vibeStarter3dDocs: Record<string, Record<string, string>> = {};
const vibeStarter3dEnvironmentDocs: Record<string, Record<string, string>> = {};

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

    // Get vibe-starter-3d docs
    const currentVibeStarter3dDocs = await getVibeLibraryDocs(files, VIBE_STARTER_3D_PACKAGE_NAME, vibeStarter3dDocs);

    if (currentVibeStarter3dDocs) {
      Object.keys(tools).forEach((key) => {
        if (currentVibeStarter3dDocs.hasOwnProperty(key)) {
          logger.debug(`Found vibe-starter-3d docTools key: ${key}`);

          tools[key].execute = async () => {
            return { content: currentVibeStarter3dDocs[key] };
          };
        }
      });
    }

    // Get vibe-starter-3d-environment docs
    const currentVibeStarter3dEnvironmentDocs = await getVibeLibraryDocs(
      files,
      VIBE_STARTER_3D_ENVIRONMENT_PACKAGE_NAME,
      vibeStarter3dEnvironmentDocs,
    );

    if (currentVibeStarter3dEnvironmentDocs) {
      Object.keys(tools).forEach((key) => {
        if (currentVibeStarter3dEnvironmentDocs.hasOwnProperty(key)) {
          logger.debug(`Found vibe-starter-3d-environment docTools key: ${key}`);

          tools[key].execute = async () => {
            return { content: currentVibeStarter3dEnvironmentDocs[key] };
          };
        }
      });
    }

    return tools;
  } catch (error: any) {
    logger.error('Unexpected error creating documentation tools:', error);
    return {};
  }
}

async function getVibeLibraryDocs(
  files: any,
  packageName: string,
  savedDocs: Record<string, Record<string, string>>,
): Promise<Record<string, string> | undefined> {
  let version: string | undefined;

  try {
    version = await resolvePackageVersion(packageName, files);

    if (!version) {
      return undefined;
    }

    // If the documentation for this version is already loaded, return the existing object
    if (savedDocs[version]) {
      return savedDocs[version];
    }

    // Initialize an object for the new version of documentation
    savedDocs[version] = {};

    const docsUrl = `https://app.unpkg.com/${packageName}@${version}/files/docs`;

    const docsResponse = await fetchWithCache(docsUrl);
    const html = await docsResponse.text();

    const markdownFileNames = extractMarkdownFileNamesFromUnpkgHtml(html);

    for (const markdownFileName of markdownFileNames) {
      const markdownUrl = `https://unpkg.com/${packageName}@${version}/docs/${markdownFileName}`;
      const markdownResponse = await fetchWithCache(markdownUrl);
      const markdown = await markdownResponse.text();
      const keyName = path.basename(markdownFileName, '.md');
      savedDocs[version][keyName] = markdown;
    }

    return savedDocs[version];
  } catch (error) {
    logger.error(`getVibeLibraryDocs: ${packageName} error: ${error}`);

    // Delete the object for this version if an error occurs and version is defined
    if (version && savedDocs[version]) {
      delete savedDocs[version];
    }

    return undefined;
  }
}
