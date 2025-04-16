import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { withV8AuthUser, type ContextUser } from '~/lib/verse8/middleware';

export const loader = withV8AuthUser(meLoader, { checkCredit: true });

async function meLoader({ context }: LoaderFunctionArgs) {
  const user = context.user as ContextUser;

  return json({
    user: {
      uid: user.uid,
      email: user.email,
      walletAddress: user.walletAddress,
      isActivated: user.isActivated,
      credit: user.credit,
    },
  });
}
