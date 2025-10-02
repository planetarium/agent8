import { json, type ActionFunction } from '@remix-run/cloudflare';

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  return json(
    {
      error: 'Updates must be performed manually in a server environment',
      instructions: [
        '1. Navigate to the project directory',
        '2. Run: git fetch upstream',
        '3. Run: git pull upstream main',
        '4. Run: bun install',
        '5. Run: bun run build',
      ],
    },
    { status: 400 },
  );
};
