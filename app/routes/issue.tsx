import { ClientOnly } from 'remix-utils/client-only';
import { json } from '@remix-run/cloudflare';
import { IssueBreakdown } from '~/components/chat/IssueBreakdown.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export const loader = () => json({});

export default function IssueRoute() {
  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly>{() => <IssueBreakdown />}</ClientOnly>
    </div>
  );
}
