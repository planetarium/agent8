import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { RocketIcon } from '~/components/ui/Icons';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useWorkbenchIsDeploying } from '~/lib/hooks/useWorkbenchStore';
import LoadingSpinnerIcon from '~/components/ui/Icons/LoadingSpinnerIcon';

export function HeaderDeployButton() {
  const isDeploying = useWorkbenchIsDeploying();
  const DEPLOY_RETRY_WINDOW = 5000;

  let lastDeployAttemptTime = 0;
  let hasBeenBlockedOnce = false;

  const handleDeploy = async () => {
    const artifactsRunning = workbenchStore.hasRunningArtifactActions();
    const now = Date.now();
    const { path: chatId, title = 'Game Project' } = repoStore.get();

    if (!chatId) {
      return;
    }

    const shouldDeploy = !artifactsRunning;
    const shouldRetryDeploy = hasBeenBlockedOnce && now - lastDeployAttemptTime <= DEPLOY_RETRY_WINDOW;
    const shouldDeployWithCancel = artifactsRunning && shouldRetryDeploy;

    if (shouldDeploy || shouldDeployWithCancel) {
      try {
        workbenchStore.setIsDeploying(true);

        if (shouldDeployWithCancel) {
          await workbenchStore.cancelAllRunningTasks();
        }

        await workbenchStore.publish(chatId, title);
      } finally {
        workbenchStore.setIsDeploying(false);
        hasBeenBlockedOnce = false;
        lastDeployAttemptTime = 0;
      }
      return;
    }

    hasBeenBlockedOnce = true;
    lastDeployAttemptTime = now;
  };

  return (
    <Tooltip.Root delayDuration={100}>
      <Tooltip.Trigger asChild>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDeploy}
            data-track="editor-deploy"
            className="group relative flex h-10 justify-center items-center gap-2 py-3 px-4 rounded-[4px] border border-white/12 bg-[#1A92A4] hover:bg-[#1A7583] active:bg-[#1B5862] hover:border-[#1A7583] active:border-[#1B5862] focus:outline-none focus-visible:after:content-[''] focus-visible:after:absolute focus-visible:after:inset-[-3px] focus-visible:after:rounded-[4px] focus-visible:after:border focus-visible:after:border-[#1A92A4] focus-visible:after:pointer-events-none disabled:border-disabled disabled:bg-disabled"
          >
            <RocketIcon width={20} height={20} />
            <span className="group-disabled:text-disabled text-[14px] font-semibold leading-[142.9%] text-interactive-on-primary hover:text-[#FCFCFD] active:text-[#FFFFFF]">
              Launch
            </span>
          </button>
          {isDeploying && <LoadingSpinnerIcon />}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
          sideOffset={5}
          side="bottom"
          align="end"
          alignOffset={0}
        >
          Let's release the game!
          <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-35px]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
