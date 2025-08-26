import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText, type Messages } from '~/lib/.server/llm/stream-text';
import { createScopedLogger } from '~/utils/logger';
import { getMCPConfigFromCookie } from '~/lib/api/cookies';
import { createToolSet } from '~/lib/modules/mcp/toolset';
import { withV8AuthUser, type ContextUser } from '~/lib/verse8/middleware';
import { extractTextContent } from '~/utils/message';

export const action = withV8AuthUser(chatAction, { checkCredit: true });

const logger = createScopedLogger('api.chat');

async function chatAction({ context, request }: ActionFunctionArgs) {
  const env = { ...context.cloudflare.env, ...process.env } as Env;
  const { messages, files } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
  }>();

  const cookieHeader = request.headers.get('Cookie');

  try {
    const mcpConfig = getMCPConfigFromCookie(cookieHeader);
    const mcpToolset = await createToolSet(mcpConfig, (context.user as ContextUser)?.accessToken);
    const mcpTools = mcpToolset.tools;
    logger.debug(`mcpConfig: ${JSON.stringify(mcpConfig)}`);

    const totalMessageContent = messages.reduce((acc, message) => acc + extractTextContent(message), '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    const result = await streamText({
      messages,
      env,
      files,
      tools: mcpTools,
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse();
  } catch (error: any) {
    logger.error(error);

    if (error.message?.includes('API key')) {
      throw new Response('Invalid or missing API key', {
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
