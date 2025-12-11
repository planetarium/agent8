import { useStore } from '@nanostores/react';
import { AnimatePresence, motion } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useEffect, useRef, useState } from 'react';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import Lottie from 'lottie-react';

import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';
import { useWorkbenchArtifacts } from '~/lib/hooks/useWorkbenchStore';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { WORK_DIR } from '~/utils/constants';
import { checkCircleAnimationData } from '~/utils/animationData';

import { FileIcon } from '~/components/ui/Icons';

const highlighterOptions = {
  langs: ['shell'],
  themes: ['light-plus', 'dark-plus'],
};

const shellHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.shellHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.shellHighlighter = shellHighlighter;
}

interface ArtifactProps {
  messageId: string;
  artifactId: string;
}

export const Artifact = memo(({ artifactId }: ArtifactProps) => {
  const userToggledActions = useRef(false);
  const [showActions, setShowActions] = useState(false);
  const [allActionFinished, setAllActionFinished] = useState(false);

  const artifacts = useWorkbenchArtifacts();
  const artifact = artifacts[artifactId];

  // Return early if artifact is not found
  if (!artifact) {
    return null;
  }

  const actions = useStore(
    computed(artifact.runner.actions, (actions) => {
      return Object.values(actions);
    }),
  );

  const toggleActions = () => {
    userToggledActions.current = true;
    setShowActions(!showActions);
  };

  useEffect(() => {
    if (actions.length && !showActions && !userToggledActions.current) {
      setShowActions(true);
    }

    if (actions.length !== 0 && artifact.type === 'bundled') {
      const finished = !actions.find((action) => action.status !== 'complete');

      if (allActionFinished !== finished) {
        setAllActionFinished(finished);
      }
    }
  }, [actions]);

  const withHeader = artifact.title || actions.length > 1;

  const header = (
    <div className="flex">
      <button
        className="flex items-stretch bg-bolt-elements-artifacts-background hover:bg-bolt-elements-artifacts-backgroundHover w-full overflow-hidden"
        onClick={() => {
          const showWorkbench = workbenchStore.showWorkbench.get();
          workbenchStore.showWorkbench.set(!showWorkbench);
        }}
      >
        {artifact.type == 'bundled' && (
          <>
            <div className="p-4">
              {allActionFinished ? (
                <div className={'i-ph:files-light'} style={{ fontSize: '2rem' }}></div>
              ) : (
                <div className={'i-svg-spinners:90-ring-with-bg'} style={{ fontSize: '2rem' }}></div>
              )}
            </div>
            <div className="bg-bolt-elements-artifacts-borderColor w-[1px]" />
          </>
        )}
        <div className="px-5 p-3.5 w-full text-left">
          <div className="w-full text-bolt-elements-textPrimary font-medium leading-5 text-sm">{artifact?.title}</div>
          <div className="w-full w-full text-bolt-elements-textSecondary text-xs mt-0.5">Click to open Workbench</div>
        </div>
      </button>
      <div className="bg-bolt-elements-artifacts-borderColor w-[1px]" />
      <AnimatePresence>
        {actions.length && artifact.type !== 'bundled' && (
          <motion.button
            initial={{ width: 0 }}
            animate={{ width: 'auto' }}
            exit={{ width: 0 }}
            transition={{ duration: 0.15, ease: cubicEasingFn }}
            className="bg-bolt-elements-artifacts-background hover:bg-bolt-elements-artifacts-backgroundHover"
            onClick={toggleActions}
          >
            <div className="p-4">
              <div className={showActions ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold'}></div>
            </div>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className={`${withHeader ? 'artifact' : 'single-action-artifact'} flex flex-col overflow-hidden w-full`}>
      {withHeader && header}
      <AnimatePresence>
        {artifact.type !== 'bundled' && showActions && actions.length > 0 && (
          <motion.div
            className="actions"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: '0px' }}
            transition={{ duration: 0.15 }}
          >
            {withHeader && <div className="h-[1px]" />}
            <div className="text-left">
              <ActionList actions={actions} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface ShellCodeBlockProps {
  classsName?: string;
  code: string;
}

function ShellCodeBlock({ classsName, code }: ShellCodeBlockProps) {
  return (
    <div
      className={classNames('text-xs', classsName)}
      dangerouslySetInnerHTML={{
        __html: shellHighlighter.codeToHtml(code, {
          lang: 'shell',
          theme: 'dark-plus',
        }),
      }}
    ></div>
  );
}

interface ActionListProps {
  actions: ActionState[];
}

const actionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function openArtifactInWorkbench(filePath: any) {
  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

const ActionList = memo(({ actions }: ActionListProps) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-2.5">
        {actions.map((action, index) => {
          const { status, type, content } = action;
          const isLast = index === actions.length - 1;

          return (
            <motion.li
              key={index}
              variants={actionVariants}
              initial="hidden"
              animate="visible"
              transition={{
                duration: 0.2,
                ease: cubicEasingFn,
              }}
            >
              <div className="flex items-center gap-2">
                <div className={classNames('text-lg', getIconColor(action.status))}>
                  {status === 'running' ? (
                    <>
                      {type !== 'start' ? (
                        <div className="i-svg-spinners:90-ring-with-bg"></div>
                      ) : (
                        <div className="i-ph:terminal-window-duotone"></div>
                      )}
                    </>
                  ) : status === 'pending' ? (
                    <div className="i-ph:circle-duotone"></div>
                  ) : status === 'complete' ? (
                    <div style={{ width: '20px', height: '20px' }}>
                      <Lottie animationData={checkCircleAnimationData} loop={false} />
                    </div>
                  ) : status === 'failed' || status === 'aborted' ? (
                    <div className="i-ph:x"></div>
                  ) : null}
                </div>
                {type === 'file' ? (
                  <div className="flex items-center gap-1 flex-[1_0_0]">
                    <span className="text-body-sm text-tertiary">Create</span>
                    <div className="flex items-center gap-0.5">
                      <FileIcon />
                      <code
                        className="text-body-sm text-accent-primary hover:underline cursor-pointer"
                        onClick={() => openArtifactInWorkbench(action.filePath)}
                      >
                        {action.filePath}
                      </code>
                    </div>
                  </div>
                ) : type === 'modify' ? (
                  <div className="flex items-center gap-1 flex-[1_0_0]">
                    <span className="text-body-sm text-tertiary">Modify</span>
                    <div className="flex items-center gap-0.5">
                      <FileIcon />
                      <code
                        className="text-body-sm text-accent-primary hover:underline cursor-pointer"
                        onClick={() => openArtifactInWorkbench(action.filePath)}
                      >
                        {action.filePath}
                      </code>
                    </div>
                  </div>
                ) : type === 'shell' ? (
                  <div className="flex items-center w-full min-h-[28px]">
                    <span className="flex-1 text-body-sm text-tertiary">Run command</span>
                  </div>
                ) : type === 'start' ? (
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      workbenchStore.currentView.set('preview');
                    }}
                    className="flex items-center w-full min-h-[28px]"
                  >
                    <span className="flex-1 text-body-sm text-tertiary">Start Application</span>
                  </a>
                ) : null}
              </div>
              {(type === 'shell' || type === 'start') && (
                <ShellCodeBlock
                  classsName={classNames('mt-1', {
                    'mb-3.5': !isLast,
                  })}
                  code={content}
                />
              )}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

function getIconColor(status: ActionState['status']) {
  switch (status) {
    case 'pending': {
      return 'text-bolt-elements-textTertiary';
    }
    case 'running': {
      return 'text-bolt-elements-loader-progress';
    }
    case 'complete': {
      return 'text-bolt-elements-icon-success';
    }
    case 'aborted': {
      return 'text-bolt-elements-textSecondary';
    }
    case 'failed': {
      return 'text-bolt-elements-icon-error';
    }
    default: {
      return undefined;
    }
  }
}
