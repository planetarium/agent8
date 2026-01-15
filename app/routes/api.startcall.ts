import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateObject } from 'ai';
import { FIXED_MODELS } from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';
import { withV8AuthUser, type ContextConsumeUserCredit } from '~/lib/verse8/middleware';
import { TEMPLATE_SELECTION_SCHEMA } from '~/utils/selectStarterTemplate';
import type { Template } from '~/types/template';

export const action = withV8AuthUser(startcallAction, { checkCredit: true });

const logger = createScopedLogger('api.startcall');

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.

Available templates:
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <label>${template.label}</label>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Instructions:
1. For trivial tasks and simple scripts, always recommend the basic-vite-react template
2. For more complex projects, recommend templates from the provided list
3. Consider both technical requirements and tags
4. If no perfect match exists, recommend the closest option

nextActionSuggestion guidelines:
1. It's unacceptable for a project build to fail due to simple changes or code modifications. Please request the simplest next task.
2. The requested task should not cause the program build to fail once the unit task is completed.
3. To handle the first requested task, it is appropriate to have work at the level of modifying about one file.
4. Think of it as a work unit when developing rather than an implementation unit in the game.

Examples of good nextActionSuggestion:
- GOOD: Changing the texture of the map specifically
- GOOD: Placing trees on the map
- BAD: Setting the surrounding environment of the 3d map (This can involve many tasks.)

Selection examples:

User: I need to build a 2d platformer game
Expected response:
{
  "templateName": "basic-2d",
  "title": "Simple 2d platformer game",
  "projectRepo": "basic-2d-game",
  "nextActionSuggestion": "Please change background image."
}

User: Make a simple 3d rpg game
Expected response:
{
  "templateName": "basic-3d-quarterview",
  "title": "Simple 3d rpg game",
  "projectRepo": "basic-3d-rpg-game",
  "nextActionSuggestion": "Add a floor texture and skybox."
}

Return your selection as a JSON object with these exact fields:
- templateName: the selected template name (string)
- title: a proper title for the project (string)
- projectRepo: the name of the new project repository (string)
- nextActionSuggestion: suggestions for the next action (string, empty if none)

Important: Return ONLY the JSON object, no additional text or explanation.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH
`;

async function startcallAction({ context, request }: ActionFunctionArgs) {
  const env = { ...process.env, ...context.cloudflare?.env } as Env;
  const { message, template } = await request.json<{
    message: string;
    template: Template[];
  }>();

  const provider = FIXED_MODELS.SELECT_STARTER_TEMPLATE.provider;
  const model = FIXED_MODELS.SELECT_STARTER_TEMPLATE.model;

  try {
    const result = await generateObject({
      model: provider.getModelInstance({
        model,
        serverEnv: env,
      }),
      schema: TEMPLATE_SELECTION_SCHEMA,
      messages: [
        {
          role: 'system',
          content: starterTemplateSelectionPrompt(template),
          providerOptions: {
            anthropic: {
              cacheControl: { type: 'ephemeral' },
            },
          },
        },
        {
          role: 'user',
          content: `${message}`,
        },
      ],
      abortSignal: request.signal,
    });

    // Process usage after generation
    if (result.usage) {
      let cacheRead = 0;
      let cacheWrite = 0;

      if (result.providerMetadata?.anthropic) {
        const { cacheCreationInputTokens, cacheReadInputTokens } = result.providerMetadata.anthropic;
        cacheRead += Number(cacheReadInputTokens || 0);
        cacheWrite += Number(cacheCreationInputTokens || 0);
      }

      const consumeUserCredit = context.consumeUserCredit as ContextConsumeUserCredit;
      await consumeUserCredit({
        model: { provider: provider.name, name: model },
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheRead,
        cacheWrite,
        description: 'Start Call',
      });
    }

    return result.toJsonResponse();
  } catch (error: unknown) {
    logger.error(error);

    if (error instanceof Error && error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    // 실제 에러 메시지를 body에 포함시키기
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Response(errorMessage, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
