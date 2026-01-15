import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { toast } from 'react-toastify';
import { Popover, Transition } from '@headlessui/react';
import { diffLines, type Change } from 'diff';
import { ActionRunner } from '~/lib/runtime/action-runner';
import { getLanguageFromExtension } from '~/utils/getLanguageFromExtension';
import type { FileHistory } from '~/types/actions';
import { DiffView } from './DiffView';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { Slider } from '~/components/ui/Slider';
import { type WorkbenchViewType } from '~/lib/stores/workbench';
import {
  useWorkbenchShowWorkbench,
  useWorkbenchMobilePreviewMode,
  useWorkbenchSelectedFile,
  useWorkbenchCurrentDocument,
  useWorkbenchUnsavedFiles,
  useWorkbenchFiles,
  useWorkbenchCurrentView,
  useWorkbenchDiffEnabled,
  useWorkbenchDiffCommitHash,
  useWorkbenchPreviews,
  useWorkbenchStore,
  useWorkbenchConnectionState,
} from '~/lib/hooks/useWorkbenchStore';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';
import { ResourcePanel } from './ResourcePanel';
import { WorkbenchSkeleton } from './WorkbenchSkeleton';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  actionRunner: ActionRunner;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: any) => void;
}

const logger = createScopedLogger('Workbench');

type WorkbenchState = 'disconnected' | 'failed' | 'reconnecting' | 'preparing' | 'ready';

const viewTransition = { ease: cubicEasingFn };

const sliderOptions = [
  {
    value: 'preview' as WorkbenchViewType,
    text: 'Preview',
  },
  {
    value: 'resource' as WorkbenchViewType,
    text: 'Resource',
  },
  {
    value: 'code' as WorkbenchViewType,
    text: 'Code',
  },
  {
    value: 'diff' as WorkbenchViewType,
    text: 'Diff',
  },
];

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

const FileModifiedDropdown = memo(
  ({
    fileHistory,
    onSelectFile,
  }: {
    fileHistory: Record<string, FileHistory>;
    onSelectFile: (filePath: string) => void;
  }) => {
    const modifiedFiles = Object.entries(fileHistory);
    const hasChanges = modifiedFiles.length > 0;
    const [searchQuery, setSearchQuery] = useState('');

    const filteredFiles = useMemo(() => {
      return modifiedFiles.filter(([filePath]) => filePath.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [modifiedFiles, searchQuery]);

    return (
      <div className="flex items-center gap-2">
        <Popover className="relative">
          {({ open }: { open: boolean }) => (
            <>
              <Transition
                show={open}
                enter="transition duration-100 ease-out"
                enterFrom="transform scale-95 opacity-0"
                enterTo="transform scale-100 opacity-100"
                leave="transition duration-75 ease-out"
                leaveFrom="transform scale-100 opacity-100"
                leaveTo="transform scale-95 opacity-0"
              >
                <Popover.Panel className="absolute right-0 z-20 mt-2 w-80 origin-top-right rounded-xl bg-bolt-elements-background-depth-2 shadow-xl border border-bolt-elements-borderColor">
                  <div className="p-2">
                    <div className="relative mx-2 mb-2">
                      <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary">
                        <div className="i-ph:magnifying-glass" />
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto">
                      {filteredFiles.length > 0 ? (
                        filteredFiles.map(([filePath, history]) => {
                          const extension = filePath.split('.').pop() || '';
                          const language = getLanguageFromExtension(extension);

                          return (
                            <button
                              key={filePath}
                              onClick={() => onSelectFile(filePath)}
                              className="w-full px-3 py-2 text-left rounded-md hover:bg-bolt-elements-background-depth-1 transition-colors group bg-transparent"
                            >
                              <div className="flex items-center gap-2">
                                <div className="shrink-0 w-5 h-5 text-bolt-elements-textTertiary">
                                  {['typescript', 'javascript', 'jsx', 'tsx'].includes(language) && (
                                    <div className="i-ph:file-js" />
                                  )}
                                  {['css', 'scss', 'less'].includes(language) && <div className="i-ph:paint-brush" />}
                                  {language === 'html' && <div className="i-ph:code" />}
                                  {language === 'json' && <div className="i-ph:brackets-curly" />}
                                  {language === 'python' && <div className="i-ph:file-text" />}
                                  {language === 'markdown' && <div className="i-ph:article" />}
                                  {['yaml', 'yml'].includes(language) && <div className="i-ph:file-text" />}
                                  {language === 'sql' && <div className="i-ph:database" />}
                                  {language === 'dockerfile' && <div className="i-ph:cube" />}
                                  {language === 'shell' && <div className="i-ph:terminal" />}
                                  {![
                                    'typescript',
                                    'javascript',
                                    'css',
                                    'html',
                                    'json',
                                    'python',
                                    'markdown',
                                    'yaml',
                                    'yml',
                                    'sql',
                                    'dockerfile',
                                    'shell',
                                    'jsx',
                                    'tsx',
                                    'scss',
                                    'less',
                                  ].includes(language) && <div className="i-ph:file-text" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-col min-w-0">
                                      <span className="truncate text-sm font-medium text-bolt-elements-textPrimary">
                                        {filePath.split('/').pop()}
                                      </span>
                                      <span className="truncate text-xs text-bolt-elements-textTertiary">
                                        {filePath}
                                      </span>
                                    </div>
                                    {(() => {
                                      // Calculate diff stats
                                      const { additions, deletions } = (() => {
                                        if (!history.originalContent) {
                                          return { additions: 0, deletions: 0 };
                                        }

                                        const normalizedOriginal = history.originalContent.replace(/\r\n/g, '\n');
                                        const normalizedCurrent =
                                          history.versions[history.versions.length - 1]?.content.replace(
                                            /\r\n/g,
                                            '\n',
                                          ) || '';

                                        if (normalizedOriginal === normalizedCurrent) {
                                          return { additions: 0, deletions: 0 };
                                        }

                                        const changes = diffLines(normalizedOriginal, normalizedCurrent, {
                                          newlineIsToken: false,
                                          ignoreWhitespace: true,
                                          ignoreCase: false,
                                        });

                                        return changes.reduce(
                                          (acc: { additions: number; deletions: number }, change: Change) => {
                                            if (change.added) {
                                              acc.additions += change.value.split('\n').length;
                                            }

                                            if (change.removed) {
                                              acc.deletions += change.value.split('\n').length;
                                            }

                                            return acc;
                                          },
                                          { additions: 0, deletions: 0 },
                                        );
                                      })();

                                      const showStats = additions > 0 || deletions > 0;

                                      return (
                                        showStats && (
                                          <div className="flex items-center gap-1 text-xs shrink-0">
                                            {additions > 0 && <span className="text-green-500">+{additions}</span>}
                                            {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
                                          </div>
                                        )
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center p-4 text-center">
                          <div className="w-12 h-12 mb-2 text-bolt-elements-textTertiary">
                            <div className="i-ph:file-dashed" />
                          </div>
                          <p className="text-sm font-medium text-bolt-elements-textPrimary">
                            {searchQuery ? 'No matching files' : 'No modified files'}
                          </p>
                          <p className="text-xs text-bolt-elements-textTertiary mt-1">
                            {searchQuery ? 'Try another search' : 'Changes will appear here as you edit'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {hasChanges && (
                    <div className="border-t border-bolt-elements-borderColor p-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(filteredFiles.map(([filePath]) => filePath).join('\n'));
                          toast('File list copied to clipboard', {
                            icon: <div className="i-ph:check-circle text-accent-500" />,
                          });
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-3 transition-colors text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary"
                      >
                        Copy File List
                      </button>
                    </div>
                  )}
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
    );
  },
);

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});

const DiffViewWithCommitHash = memo(
  ({
    fileHistory,
    setFileHistory,
    actionRunner,
  }: {
    fileHistory: Record<string, FileHistory>;
    setFileHistory: React.Dispatch<React.SetStateAction<Record<string, FileHistory>>>;
    actionRunner: ActionRunner;
  }) => {
    const diffCommitHash = useWorkbenchDiffCommitHash();

    return (
      <DiffView
        fileHistory={fileHistory}
        setFileHistory={setFileHistory}
        actionRunner={actionRunner}
        initialCommitHash={diffCommitHash || undefined}
      />
    );
  },
);

export const Workbench = memo(({ chatStarted, isStreaming, actionRunner }: WorkspaceProps) => {
  logger.trace('Workbench');

  const [fileHistory, setFileHistory] = useState<Record<string, FileHistory>>({});
  const [terminalReady, setTerminalReady] = useState<boolean>(false);
  const [isManuallyReconnecting, setIsManuallyReconnecting] = useState<boolean>(false);

  const connectionState = useWorkbenchConnectionState();

  const workbenchState: WorkbenchState = useMemo(() => {
    if (isManuallyReconnecting) {
      return 'preparing';
    }

    if (connectionState === 'reconnecting') {
      return 'reconnecting';
    }

    if (connectionState === 'failed') {
      return 'failed';
    }

    if (connectionState === 'disconnected') {
      return 'disconnected';
    }

    if (connectionState === 'connected' && !terminalReady) {
      return 'preparing';
    }

    return 'ready';
  }, [connectionState, terminalReady, isManuallyReconnecting]);
  const previews = useWorkbenchPreviews();
  const hasPreview = previews.length > 0;
  const showWorkbench = useWorkbenchShowWorkbench();
  const mobilePreviewMode = useWorkbenchMobilePreviewMode();
  const selectedFile = useWorkbenchSelectedFile();
  const currentDocument = useWorkbenchCurrentDocument();
  const unsavedFiles = useWorkbenchUnsavedFiles();
  const files = useWorkbenchFiles();
  const selectedView = useWorkbenchCurrentView();
  const diffEnabled = useWorkbenchDiffEnabled();
  const workbench = useWorkbenchStore();

  const isSmallViewport = useViewport(MOBILE_BREAKPOINT); // Mobile breakpoint - same as BaseChat

  const filteredSliderOptions = useMemo(() => {
    return sliderOptions.filter((option) => {
      if (!diffEnabled && option.value === 'diff') {
        return false;
      }

      return true;
    });
  }, [diffEnabled]);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbench.currentView.set(view);
  };

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    if (!diffEnabled && selectedView === 'diff') {
      setSelectedView('code');
    }
  }, [diffEnabled, selectedView]);

  useEffect(() => {
    workbench.setDocuments(files);
  }, [files]);

  useEffect(() => {
    if (chatStarted) {
      const initializeTerminal = async () => {
        const shell = workbench.boltTerminal;

        await shell.ready;
        setTerminalReady(true);
        setIsManuallyReconnecting(false);
      };

      initializeTerminal();
    }
  }, [chatStarted, workbench.boltTerminal]);

  useEffect(() => {
    if (connectionState === 'connected' && terminalReady) {
      setIsManuallyReconnecting(false);
    }
  }, [connectionState, terminalReady]);

  const onEditorChange = useCallback<OnEditorChange>(
    (update) => {
      workbench.setDocumentContentByPath(update.filePath, update.content);
    },
    [workbench],
  );

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbench.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback(
    (filePath: string | undefined) => {
      workbench.setSelectedFile(filePath);
    },
    [workbench],
  );

  const onFileSave = useCallback(() => {
    workbench.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, [workbench]);

  const onFileReset = useCallback(() => {
    workbench.resetCurrentDocument();
  }, [workbench]);

  // On mobile, use a hidden div instead of motion.div to prevent animation flicker
  const WorkbenchWrapper = isSmallViewport ? 'div' : motion.div;
  const wrapperProps = isSmallViewport
    ? { className: 'z-workbench w-0 overflow-hidden' }
    : {
        initial: 'closed' as const,
        animate: showWorkbench ? 'open' : 'closed',
        variants: workbenchVariants,
        className: 'z-workbench',
      };

  return (
    chatStarted && (
      <WorkbenchWrapper {...wrapperProps}>
        {showWorkbench && !isSmallViewport && (workbenchState === 'disconnected' || workbenchState === 'failed') && (
          <div className="fixed top-[calc(var(--header-height)+0.5rem)] bottom-4 w-[var(--workbench-inner-width)] mr-4 z-10 left-[var(--workbench-left)] transition-[left,width] duration-200 bolt-ease-cubic-bezier">
            <div className="absolute inset-0 pr-7">
              <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
                <div className="absolute inset-0 z-50 bg-bolt-elements-background-depth-2 bg-opacity-75 flex items-center justify-center">
                  <div className="p-4 rounded-lg bg-bolt-elements-background-depth-3 shadow-lg">
                    {connectionState === 'reconnecting' ? (
                      <>
                        <div className="w-5 h-5 mx-auto mb-2 border-2 border-bolt-elements-button-primary-background border-t-transparent rounded-full animate-spin" />
                        <div className="text-sm text-bolt-elements-textPrimary">Reconnecting to Server...</div>
                      </>
                    ) : (
                      <>
                        <div className="w-6 h-6 mb-2 mx-auto text-red-400">
                          <div className="i-ph:wifi-slash" />
                        </div>
                        <div className="text-sm text-bolt-elements-textPrimary">Server Disconnected</div>
                        <button
                          onClick={async () => {
                            /*
                             * FIXME: After stabilizing reconnecting, we can replace this with a proper reconnecting mechanism.
                             * See also: https://github.com/planetarium/agent8/issues/269
                             */
                            window.location.reload();
                          }}
                          className="px-3 py-1.5 text-sm rounded bg-accent-500 hover:bg-accent-600 text-white transition-colors mx-auto block"
                        >
                          Reconnect
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showWorkbench && !isSmallViewport && (workbenchState === 'preparing' || workbenchState === 'reconnecting') && (
          <WorkbenchSkeleton isSmallViewport={isSmallViewport} variant="preparing" />
        )}

        <div
          className={classNames('fixed z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier', {
            'top-[calc(var(--header-height)+0.5rem)] bottom-4.5 mr-4 left-[100%] pointer-events-none w-[var(--workbench-inner-width)]':
              isSmallViewport && !mobilePreviewMode,
            'top-0 bottom-0 left-0 right-0 w-full': isSmallViewport && mobilePreviewMode,
            'top-[calc(var(--header-height)+0.5rem)] bottom-4.5 mr-4 left-[var(--workbench-left)] w-[var(--workbench-inner-width)]':
              showWorkbench && !isSmallViewport,
            'top-[calc(var(--header-height)+0.5rem)] bottom-4.5 mr-4 left-[100%] w-[var(--workbench-inner-width)]':
              !showWorkbench && !isSmallViewport,
          })}
        >
          <div
            className={classNames('absolute inset-0', {
              'pr-7': !(isSmallViewport && mobilePreviewMode),
            })}
          >
            <div
              className={classNames('h-full flex flex-col overflow-hidden', {
                'bg-primary': isSmallViewport && mobilePreviewMode,
                'border border-tertiary shadow-sm rounded-lg p-4 bg-transperant-subtle': !(
                  isSmallViewport && mobilePreviewMode
                ),
              })}
            >
              {/* Hide Slider and other tabs on mobile preview mode */}
              {!(isSmallViewport && mobilePreviewMode) && (
                <div className="flex items-center">
                  <Slider selected={selectedView} options={filteredSliderOptions} setSelected={setSelectedView} />

                  {selectedView === 'diff' && (
                    <div className="ml-auto">
                      <FileModifiedDropdown fileHistory={fileHistory} onSelectFile={onFileSelect} />
                    </div>
                  )}
                </div>
              )}
              <div className="relative flex-1 overflow-hidden">
                {/* Code view - hidden off-screen on mobile preview mode but still rendered for terminal */}
                <View
                  initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  animate={{
                    x: isSmallViewport && mobilePreviewMode ? '-100%' : selectedView === 'code' ? 0 : '-100%',
                  }}
                  style={{
                    visibility: isSmallViewport && mobilePreviewMode ? 'hidden' : 'visible',
                  }}
                >
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                {/* Hide other views on mobile preview mode */}
                {!(isSmallViewport && mobilePreviewMode) && (
                  <>
                    <View
                      initial={{ x: '100%' }}
                      animate={{ x: selectedView === 'resource' ? '0%' : selectedView === 'code' ? '100%' : '-100%' }}
                    >
                      <ResourcePanel
                        editorDocument={currentDocument}
                        isStreaming={isStreaming}
                        selectedFile={selectedFile}
                        files={files}
                        unsavedFiles={unsavedFiles}
                        onFileSelect={onFileSelect}
                        onEditorScroll={onEditorScroll}
                        onEditorChange={onEditorChange}
                        onFileSave={onFileSave}
                        onFileReset={onFileReset}
                      />
                    </View>
                    <View
                      initial={{ x: '100%' }}
                      animate={{ x: selectedView === 'diff' ? '0%' : selectedView === 'code' ? '100%' : '-100%' }}
                    >
                      <DiffViewWithCommitHash
                        fileHistory={fileHistory}
                        setFileHistory={setFileHistory}
                        actionRunner={actionRunner}
                      />
                    </View>
                  </>
                )}
                {/* Preview - always visible, full screen on mobile preview mode */}
                <View
                  initial={{ x: isSmallViewport && mobilePreviewMode ? 0 : selectedView === 'preview' ? 0 : '100%' }}
                  animate={{ x: isSmallViewport && mobilePreviewMode ? 0 : selectedView === 'preview' ? 0 : '100%' }}
                >
                  <Preview isStreaming={isStreaming} workbenchState={workbenchState} />
                </View>
              </div>
            </div>
          </div>
        </div>
      </WorkbenchWrapper>
    )
  );
});
