import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { IssueBreakdown } from '~/components/chat/IssueBreakdown.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export async function loader(args: LoaderFunctionArgs) {
  const projectPath = args.params.user + '/' + args.params.repo;

  return json({
    id: projectPath,
    projectPath,
    user: args.params.user,
    repo: args.params.repo,
  });
}

export default function IssueProjectRoute() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly>{() => <IssueBreakdown />}</ClientOnly>
    </div>
  );
}
