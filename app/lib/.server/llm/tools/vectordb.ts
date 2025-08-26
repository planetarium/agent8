import { tool } from 'ai';
import { z } from 'zod/v3';
import { createClient } from '@supabase/supabase-js';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('vectordb-tools');

/**
 * Creates tools for searching code examples in the vector database
 * @param env Environment variables containing Supabase credentials
 * @returns An object with vector database search tools
 */
export async function createSearchCodebase(env: Env): Promise<Record<string, any>> {
  const isProduction = env.USE_PRODUCTION_VECTOR_DB === 'true';

  try {
    const tools: Record<string, any> = {};

    // Tool to search for relevant code examples by semantic queries
    tools.search_codebase_vectordb_items = tool({
      description:
        'Search the vector database for 3D game development code examples based on natural language queries. This database is specifically for 3D game implementations like (implementing trees in a 3D world), (3D skybox setup examples). This tool should be called only once with carefully selected search phrases focused on 3D game development. Carefully review the returned descriptions to determine if the code examples are useful for your task. If you find relevant examples, you must then call read_codebase_vectordb_contents with the item IDs to retrieve the actual code implementations.',
      inputSchema: z.object({
        keywords: z
          .array(z.string())
          .describe(
            'Array of natural language phrases or concepts related to 3D game development to search for in the codebase',
          ),
      }),
      execute: async ({ keywords }) => {
        try {
          const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

          const openai = createOpenAI({
            apiKey: env.OPENAI_API_KEY,
          });

          const results = [];
          const seenIds = new Set<string>();

          // Search for each semantic query
          for (const keyword of keywords) {
            try {
              const { embedding } = await embed({
                model: openai.embedding('text-embedding-ada-002'),
                value: keyword,
              });

              const { data, error } = await supabase.rpc(isProduction ? 'match_codebase_prod' : 'match_codebase', {
                query_embedding: embedding,
                match_count: 5,
              });

              if (error) {
                logger.error(`Vector search error for "${keyword}":`, error);
                continue;
              }

              if (data && data.length > 0) {
                // Only add items that haven't been seen before
                for (const item of data) {
                  if (!seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    results.push({
                      id: item.id,
                      path: item.path,
                      description: item.description,
                      metadata: item.metadata,
                      similarity: item.similarity,
                    });
                  }
                }
              }
            } catch (error) {
              logger.error(`Error searching for "${keyword}":`, error);
            }
          }

          return {
            content: `Found ${results.length} relevant 3D game code examples. If you want to see an example, please use the \`read_codebase_vectordb_contents\` tool.`,
            items: results,
          };
        } catch (error) {
          logger.error('Error in search_codebase_vectordb_items:', error);
          return { content: 'Error searching codebase', items: [] };
        }
      },
    });

    // Tool to fetch full code contents by ids
    tools.read_codebase_vectordb_contents = tool({
      description:
        "Retrieve the full content of specific 3D game code examples from the vector database using their IDs. This tool should only be called once after you've identified relevant code examples using search_codebase_vectordb_items. Use this to get the complete implementation details for 3D game features.",
      inputSchema: z.object({
        ids: z.array(z.coerce.string()).describe('Array of 3D game code example IDs to retrieve content for'),
      }),
      execute: async ({ ids }) => {
        try {
          if (!ids || ids.length === 0) {
            return { content: 'No IDs provided', items: [] };
          }

          const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

          const { data, error } = await supabase
            .from(isProduction ? 'codebase_prod' : 'codebase')
            .select('id, path, description, client_code, server_code')
            .in('id', ids);

          if (error) {
            logger.error('Error fetching code contents:', error);
            return { content: 'Error fetching code contents', items: [] };
          }

          if (!data || data.length === 0) {
            return { content: 'No code examples found with provided IDs', items: [] };
          }

          return {
            content: `Retrieved ${data.length} 3D game code examples`,
            items: data,
          };
        } catch (error) {
          logger.error('Error in read_codebase_vectordb_contents:', error);
          return { content: 'Error retrieving code contents', items: [] };
        }
      },
    });

    return tools;
  } catch (error: any) {
    logger.error('Unexpected error creating codebase search tools:', error);
    return {};
  }
}

/**
 * Creates tools for searching resources in the vector database
 * @param env Environment variables containing Supabase credentials
 * @returns An object with vector database resource search tools
 */
export async function createSearchResources(env: Env): Promise<Record<string, any>> {
  try {
    const tools: Record<string, any> = {};

    // Tool to search for relevant resources
    tools.search_resources_vectordb_items = tool({
      description:
        "Search the vector database for 3D game development resources based on natural language queries. This database is exclusively for 3D game assets and resources like '3D 캐릭터 모델링' (3D character models), '리얼리스틱 텍스처 팩' (realistic texture packs), or 'game environment sound effects'. This tool should be called only once with carefully selected search phrases focused on 3D game development resources. You'll need to analyze the results to determine if they're useful for your task.",
      inputSchema: z.object({
        keywords: z
          .array(z.string())
          .describe(
            'Array of natural language phrases or concepts related to 3D game development resources to search for',
          ),
      }),
      execute: async ({ keywords }) => {
        try {
          const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

          const openai = createOpenAI({
            apiKey: env.OPENAI_API_KEY,
          });

          const isProduction = env.USE_PRODUCTION_VECTOR_DB === 'true';
          const results = [];
          const seenIds = new Set<string>();

          // Search for each semantic query
          for (const keyword of keywords) {
            try {
              const { embedding } = await embed({
                model: openai.embedding('text-embedding-ada-002'),
                value: keyword,
              });

              const { data, error } = await supabase.rpc(isProduction ? 'match_resources_prod' : 'match_resources', {
                query_embedding: embedding,
                match_count: 20,
              });

              if (error) {
                logger.error(`Vector search error for "${keyword}":`, error);
                continue;
              }

              if (data && data.length > 0) {
                // Only add items that haven't been seen before
                for (const item of data) {
                  if (!seenIds.has(item.id)) {
                    seenIds.add(item.id);
                    results.push({
                      id: item.id,
                      description: item.description,
                      url: item.url,
                      metadata: item.metadata,
                      similarity: item.similarity,
                    });
                  }
                }
              }
            } catch (error) {
              logger.error(`Error searching for "${keyword}":`, error);
            }
          }

          return {
            content: `Found ${results.length} relevant 3D game resources`,
            items: results,
          };
        } catch (error) {
          logger.error('Error in search_resources_vectordb_items:', error);
          return { content: 'Error searching resources', items: [] };
        }
      },
    });

    return tools;
  } catch (error: any) {
    logger.error('Unexpected error creating resource search tools:', error);
    return {};
  }
}
