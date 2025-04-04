import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('credit');

export async function getUserCredit(
  endpoint: string,
  userUid: string,
  creditCredentials: { clientId: string; clientSecret: string },
): Promise<bigint> {
  try {
    const response = await fetch(endpoint + `/v1/users/${userUid}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': creditCredentials.clientId,
        'x-client-secret': creditCredentials.clientSecret,
      },
    });

    if (response.status === 404) {
      return 0n;
    }

    if (!response.ok) {
      throw new Error('Failed to get user credit');
    }

    const { credits } = (await response.json()) as {
      credits: string;
    };

    return BigInt(credits);
  } catch (error) {
    logger.error('Failed to get user credit', error);
    throw new Error('Failed to get user credit');
  }
}

export async function consumeUserCredit(
  endpoint: string,
  userUid: string,
  creditCredentials: { clientId: string; clientSecret: string },
  consumeArgs: {
    model: {
      provider: string;
      name: string;
    };
    inputTokens: number;
    outputTokens: number;
    description?: string;
  },
) {
  if (!userUid) {
    throw new Error('User token is required');
  }

  const response = await fetch(endpoint + '/v1/credits/consume', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': creditCredentials.clientId,
      'x-client-secret': creditCredentials.clientSecret,
    },
    body: JSON.stringify({
      userUid,
      llmProvider: consumeArgs.model.provider,
      llmModelName: consumeArgs.model.name,
      inputTokens: consumeArgs.inputTokens,
      outputTokens: consumeArgs.outputTokens,
      description: consumeArgs.description || 'Agent8 Chat',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to consume credit ' + userUid);
  }
}
