import { tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('docs-tools');

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
export async function createDocTools(env: Env): Promise<Record<string, any>> {
  try {
    // Create Supabase client
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all documentation tools from the table
    const { data, error } = await supabase.from('docs').select('*');

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
      tools[doc.tool_name] = tool({
        description: doc.description,
        parameters: z.object({}), // No parameters needed as these are simple documentation responses
        execute: async () => {
          return { content: doc.response };
        },
      });
    }

    return tools;
  } catch (error: any) {
    logger.error('Unexpected error creating documentation tools:', error);
    return {};
  }
}
