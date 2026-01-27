import { workbenchStore } from '~/lib/stores/workbench';
import { repoStore } from '~/lib/stores/repo';
import { RocketIcon } from '~/components/ui/Icons';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useWorkbenchIsDeploying } from '~/lib/hooks/useWorkbenchStore';
import LoadingSpinnerIcon from '~/components/ui/Icons/LoadingSpinnerIcon';
import CustomIconButton from '~/components/ui/CustomIconButton';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { DeployError } from '~/utils/errors';
import { toast } from 'react-toastify';
import { useRef } from 'react';

export function HeaderDeployButton() {
  const isDeploying = useWorkbenchIsDeploying();
  const DEPLOY_RETRY_WINDOW = 5000;

  const lastDeployAttemptTimeRef = useRef(0);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  const handleDeploy = async () => {
    const { path: chatId, title = 'Game Project' } = repoStore.get();

    if (!chatId) {
      return;
    }

    const now = Date.now();
    const isArtifactsRunning = workbenchStore.hasRunningArtifactActions();
    const isRetryAttempt = now - lastDeployAttemptTimeRef.current <= DEPLOY_RETRY_WINDOW;
    lastDeployAttemptTimeRef.current = now;

    if (isArtifactsRunning && !isRetryAttempt) {
      return;
    }

    // run deploy
    try {
      if (isArtifactsRunning) {
        workbenchStore.abortAllActions();
      }

      await workbenchStore.publish(chatId, title);
    } catch (error) {
      const errorMessage = error instanceof DeployError ? error.message : 'Failed to deploy';
      toast.warning(errorMessage);
    } finally {
      lastDeployAttemptTimeRef.current = 0;
    }
  };

  if (isSmallViewport) {
    return (
      <CustomIconButton
        icon={isDeploying ? <LoadingSpinnerIcon /> : <RocketIcon fill="#11B9D2" width={20} height={20} />}
        variant="primary-transparent"
        size="md"
        onClick={handleDeploy}
        disabled={isDeploying}
        data-track="editor-deploy"
      />
    );
  }

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
          className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
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
