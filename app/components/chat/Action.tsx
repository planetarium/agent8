import { useStore } from '@nanostores/react';
import { memo } from 'react';
import { motion } from 'framer-motion';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import { workbenchStore } from '~/lib/stores/workbench';
import { useWorkbenchMessageRunners } from '~/lib/hooks/useWorkbenchStore';
import { classNames } from '~/utils/classNames';
import { WORK_DIR } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';

const highlighterOptions = {
  langs: ['shell'],
  themes: ['light-plus', 'dark-plus'],
};

const shellHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.shellHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.shellHighlighter = shellHighlighter;
}

interface ActionProps {
  messageId: string;
  actionId: string;
}

const actionVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

function getIconColor(status: string) {
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
      return 'text-bolt-elements-textSecondary';
    }
  }
}

export const Action = memo(({ messageId, actionId }: ActionProps) => {
  const messageRunners = useWorkbenchMessageRunners();
  const messageRunner = messageRunners[messageId];

  // Return early if message runner is not found
  if (!messageRunner) {
    return null;
  }

  const actions = useStore(messageRunner.runner.actions);
  const action = actions[actionId];

  if (!action) {
    return null;
  }

  const openFileInWorkbench = (filePath: string) => {
    if (workbenchStore.currentView.get() !== 'code') {
      workbenchStore.currentView.set('code');
    }

    workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
  };

  const getActionIcon = () => {
    const { status, type } = action;

    if (status === 'running') {
      if (type !== 'start') {
        return <div className="i-svg-spinners:90-ring-with-bg"></div>;
      } else {
        return <div className="i-ph:terminal-window-duotone"></div>;
      }
    } else if (status === 'pending') {
      return <div className="i-ph:circle-duotone"></div>;
    } else if (status === 'complete') {
      return <div className="i-ph:check"></div>;
    } else if (status === 'failed' || status === 'aborted') {
      return <div className="i-ph:x"></div>;
    }

    return <div className="i-ph:circle-duotone"></div>;
  };

  return (
    <div className="artifact border border-bolt-elements-borderColor flex flex-col overflow-hidden rounded-lg w-full transition-border duration-150 mb-4">
      <motion.div className="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
        <div className="p-5 text-left bg-bolt-elements-actions-background">
          <motion.div
            variants={actionVariants}
            initial="hidden"
            animate="visible"
            transition={{
              duration: 0.2,
              ease: cubicEasingFn,
            }}
          >
            <div className="flex items-center gap-1.5 text-sm">
              <div className={classNames('text-lg', getIconColor(action.status))}>{getActionIcon()}</div>
              {action.type === 'file' ? (
                <div>
                  Create{' '}
                  <code
                    className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
                    onClick={() => openFileInWorkbench(action.filePath)}
                  >
                    {action.filePath}
                  </code>
                </div>
              ) : action.type === 'modify' ? (
                <div>
                  Modify{' '}
                  <code
                    className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
                    onClick={() => openFileInWorkbench(action.filePath)}
                  >
                    {action.filePath}
                  </code>
                </div>
              ) : action.type === 'shell' ? (
                <div className="flex items-center w-full min-h-[28px]">
                  <span className="flex-1">Run command</span>
                </div>
              ) : action.type === 'start' ? (
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    workbenchStore.currentView.set('preview');
                  }}
                  className="flex items-center w-full min-h-[28px] cursor-pointer"
                >
                  <span className="flex-1">Start Application</span>
                </a>
              ) : null}
            </div>
            {(action.type === 'shell' || action.type === 'start') && action.content && (
              <div
                className="mt-1 text-xs"
                dangerouslySetInnerHTML={{
                  __html: shellHighlighter.codeToHtml(action.content, {
                    lang: 'shell',
                    theme: 'dark-plus',
                  }),
                }}
              />
            )}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
});
