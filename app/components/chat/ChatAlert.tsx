import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import type { ActionAlert } from '~/types/actions';
import { classNames } from '~/utils/classNames';

interface Props {
  autoFixChance: number;
  alert: ActionAlert;
  clearAlert: () => void;
  postMessage: (message: string, isAutoFix?: boolean) => void;
}

export default function ChatAlert({ autoFixChance, alert, clearAlert, postMessage }: Props) {
  const { description, content, source } = alert;

  const isPreview = source === 'preview';
  const title = isPreview ? 'Preview Error' : 'Terminal Error';
  const message = isPreview
    ? 'We encountered an error while running the preview. Would you like Agent8 to analyze and help resolve this issue?'
    : 'We encountered an error while running terminal commands. Would you like Agent8 to analyze and help resolve this issue?';

  const handleAskBolt = (isAutoFix = false) => {
    postMessage(
      `*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`,
      isAutoFix,
    );
  };

  useEffect(() => {
    if (autoFixChance > 0) {
      handleAskBolt(true);
    }
  }, [autoFixChance]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="flex p-[var(--spacing-16,16px)] items-start gap-5 rounded-[var(--border-radius-8,8px)] bg-[rgba(253,176,34,0.10)] mx-auto"
      >
        <div className="flex-shrink-0">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }}>
            <img src="/icons/Warning.svg" alt="Warning" />
          </motion.div>
        </div>
        {/* Content */}
        <div className="flex-1 gap-4">
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-[var(--color-text-primary,#FFF)] font-feature-stylistic font-primary text-md font-semibold leading-[140%]"
          >
            {title}
          </motion.h3>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className={`mt-2`}>
            <p className="text-[var(--color-text-tertiary,#99A2B0)] font-primary text-sm font-medium leading-[150%]">
              {message}
            </p>
            {description && (
              <div className="text-[12px] text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-4 mb-4 max-h-[80px] overflow-y-auto">
                Error: {description}
              </div>
            )}
          </motion.div>

          {/* Actions */}
          <motion.div
            className="mt-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className={classNames('flex justify-end gap-2')}>
              <button
                onClick={clearAlert}
                className="flex min-h-[40px] max-h-[40px] px-[var(--spacing-14,14px)] py-[var(--spacing-10,10px)] justify-center items-center gap-[var(--spacing-6,6px)] rounded-[var(--border-radius-4,4px)] border border-[var(--color-border-interactive-neutral,rgba(255,255,255,0.18))] bg-[var(--color-bg-interactive-neutral,#222428)]"
              >
                <span className="text-[var(--color-text-interactive-neutral,#F3F5F8)] font-feature-stylistic font-primary text-[14px] font-semibold leading-[142.9%]">
                  Dismiss
                </span>
              </button>
              <button
                onClick={() => handleAskBolt(false)}
                className="flex min-h-[40px] max-h-[40px] px-[var(--spacing-14,14px)] py-[var(--spacing-10,10px)] justify-center items-center gap-[var(--spacing-6,6px)] rounded-[var(--border-radius-4,4px)] border border-[var(--color-border-interactive-neutral,rgba(255,255,255,0.18))] bg-[var(--color-bg-interactive-primary,#1A92A4)]"
              >
                <img src="/icons/Wrench.svg" alt="Fix" width="20" height="20" />
                <span className="text-[var(--color-text-interactive-on-primary,#F3F5F8)] font-feature-stylistic font-primary text-[14px] font-semibold leading-[142.9%]">
                  Fix Error
                </span>
              </button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
