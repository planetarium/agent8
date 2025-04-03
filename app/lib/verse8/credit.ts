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
    console.error('Failed to get user credit', error);
    throw new Error('Failed to get user credit');
  }
}

export async function consumeUserCredit(
  endpoint: string,
  userUid: string,
  creditCredentials: { clientId: string; clientSecret: string },
  inputTokens: string,
  outputTokens: string,
  description?: string,
  model: {
    provider: string;
    name: string;
  } = {
    provider: 'Anthropic',
    name: 'Claude 3.7 Sonnet',
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
      llmProvider: model.provider,
      llmModelName: model.name,
      inputTokens,
      outputTokens,
      description: description || 'Agent8 Chat',
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to consume credit ' + userUid);
  }
}
