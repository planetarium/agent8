import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import useViewport from '~/lib/hooks';
import { PushToGitHubDialog } from '~/components/@settings/tabs/connections/components/PushToGitHubDialog';
import { chatId as chatIdStore, description as descriptionStore } from '~/lib/persistence';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

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

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isPushDialogOpen, setIsPushDialogOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);

  const isSmallViewport = useViewport(1024);

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onRun = useCallback(async () => {
    setSelectedView('code');

    const shell = workbenchStore.boltTerminal;

    await shell.ready();

    await shell.executeCommand(Date.now().toString(), 'npm install && npm run dev');
  }, []);

  const onPublish = useCallback(async () => {
    try {
      setIsPublishing(true);
      setSelectedView('code');

      // WebContainer 터미널에 접근
      const shell = workbenchStore.boltTerminal;
      const chatId = chatIdStore.get();

      // 터미널이 준비되었는지 확인
      await shell.ready();

      await shell.executeCommand(Date.now().toString(), 'npm install');

      await shell.waitTillOscCode('prompt');

      const buildResult = await shell.executeCommand(Date.now().toString(), 'npm run build');

      await shell.waitTillOscCode('prompt');

      console.log('[Publish] Build Result:', buildResult);

      if (buildResult?.exitCode === 2) {
        console.log('[Publish] Build Failed:', buildResult.output);
        toast.error('Failed to build');

        // 빌드 에러 발생 시 actionAlert 설정
        workbenchStore.actionAlert.set({
          type: 'build',
          title: 'Build Error',
          description: 'Failed to build the project',
          content: buildResult.output || 'Unknown build error',
          source: 'terminal',
        });

        return;
      }

      const result = await shell.executeCommand(Date.now().toString(), 'npx -y @agent8/deploy');

      await shell.waitTillOscCode('prompt');

      console.log('[Publish] Result:', result);

      if (result?.exitCode === 0) {
        toast.success('Publish completed successfully');

        // 퍼블리시된 URL 설정
        const publishedUrl = `https://agent8-games.verse8.io/${chatId}/index.html?buildAt=${Date.now()}`;
        workbenchStore.setPublishedUrl(publishedUrl);

        // 상위 창에 배포 정보 전달
        try {
          if (window.parent && window.parent !== window) {
            const title = descriptionStore.get() || 'Game Project';

            window.parent.postMessage(
              {
                type: 'PUBLISH_GAME',
                payload: {
                  title,
                  playUrl: publishedUrl,
                },
              },
              '*',
            );

            console.log('[Publish] Sent deployment info to parent window');
          }
        } catch (error) {
          console.error('[Publish] Error sending message to parent:', error);

          // 부모 창 통신 실패는 배포 성공에 영향을 주지 않으므로 오류만 기록
        }

        // 퍼블리시 완료 후 Preview 탭으로 전환
        setSelectedView('preview');
      } else {
        toast.error('Failed to publish');
      }
    } catch (error) {
      console.error('Error executing publish command:', error);
      toast.error('Failed to execute publish command');
    } finally {
      setIsPublishing(false);
    }
  }, [workbenchStore.boltTerminal, setSelectedView]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const handleSyncFiles = useCallback(async () => {
    setIsSyncing(true);

    try {
      const directoryHandle = await window.showDirectoryPicker();
      await workbenchStore.syncFiles(directoryHandle);
      toast.success('Files synced successfully');
    } catch (error) {
      console.error('Error syncing files:', error);
      toast.error('Failed to sync files');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  return (
    chatStarted && (
      <motion.div
        initial="closed"
        animate={showWorkbench ? 'open' : 'closed'}
        variants={workbenchVariants}
        className="z-workbench"
      >
        <div
          className={classNames(
            'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'w-full': isSmallViewport,
              'left-0': showWorkbench && isSmallViewport,
              'left-[var(--workbench-left)]': showWorkbench,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 px-2 lg:px-6">
            <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
              <div className="flex items-center px-3 py-2 border-b border-bolt-elements-borderColor">
                <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />
                <button
                  onClick={() => {
                    onRun();
                  }}
                  className={classNames(
                    'bg-transparent text-sm px-2.5 py-0.5 rounded-full relative',
                    'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive flex items-center space-x-1',
                  )}
                >
                  <div className="i-ph:play" />
                  <span>Run</span>
                </button>
                <button
                  onClick={() => {
                    onPublish();
                  }}
                  className={classNames(
                    'bg-transparent text-sm px-2.5 py-0.5 rounded-full relative',
                    'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive',
                    {
                      'opacity-50 cursor-not-allowed flex items-center': isPublishing,
                    },
                  )}
                >
                  {isPublishing ? (
                    <>
                      <div className="i-ph:spinner animate-spin mr-2" />
                      Publishing...
                    </>
                  ) : (
                    <span className="relative z-10">Publish</span>
                  )}
                </button>
                <div className="ml-auto" />
                {selectedView === 'code' && (
                  <div className="flex overflow-y-auto">
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.downloadZip();
                      }}
                    >
                      <div className="i-ph:code" />
                      Download Code
                    </PanelHeaderButton>
                    <PanelHeaderButton className="mr-1 text-sm" onClick={handleSyncFiles} disabled={isSyncing}>
                      {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                      {isSyncing ? 'Syncing...' : 'Sync Files'}
                    </PanelHeaderButton>
                    <PanelHeaderButton
                      className="mr-1 text-sm"
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </PanelHeaderButton>
                    <PanelHeaderButton className="mr-1 text-sm" onClick={() => setIsPushDialogOpen(true)}>
                      <div className="i-ph:git-branch" />
                      Push to GitHub
                    </PanelHeaderButton>
                  </div>
                )}
                <IconButton
                  icon="i-ph:x-circle"
                  className="-mr-1"
                  size="xl"
                  onClick={() => {
                    workbenchStore.showWorkbench.set(false);
                  }}
                />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <View
                  initial={{ x: selectedView === 'code' ? 0 : '-100%' }}
                  animate={{ x: selectedView === 'code' ? 0 : '-100%' }}
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
                <View
                  initial={{ x: selectedView === 'preview' ? 0 : '100%' }}
                  animate={{ x: selectedView === 'preview' ? 0 : '100%' }}
                >
                  <Preview />
                </View>
              </div>
            </div>
          </div>
        </div>
        <PushToGitHubDialog
          isOpen={isPushDialogOpen}
          onClose={() => setIsPushDialogOpen(false)}
          onPush={async (repoName, username, token, isPrivate) => {
            try {
              const repoUrl = await workbenchStore.pushToGitHub(repoName, undefined, username, token, isPrivate);
              return repoUrl;
            } catch (error) {
              console.error('Error pushing to GitHub:', error);
              toast.error('Failed to push to GitHub');
              throw error; // Rethrow to let PushToGitHubDialog handle the error state
            }
          }}
        />
      </motion.div>
    )
  );
});

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
