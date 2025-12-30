import { memo } from 'react';
import { Markdown } from './Markdown';
import type { JSONValue } from 'ai';
import Popover from '~/components/ui/Popover';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import React from 'react';

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  metadata?: unknown;
  expanded?: boolean;
}

function openArtifactInWorkbench(filePath: string) {
  filePath = normalizedFilePath(filePath);

  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

function normalizedFilePath(path: string) {
  let normalizedPath = path;

  if (normalizedPath.startsWith(WORK_DIR)) {
    normalizedPath = path.replace(WORK_DIR, '');
  }

  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  return normalizedPath;
}

export const AssistantMessage = memo(({ content, annotations, metadata, expanded = false }: AssistantMessageProps) => {
  const filteredAnnotations = (annotations?.filter(
    (data: JSONValue) => data && typeof data === 'object' && Object.keys(data).includes('type'),
  ) || []) as { type: string; value: any } & { [key: string]: any }[];

  // Find annotations once and reuse results to avoid duplicate find operations
  const chatSummaryAnnotation = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary');
  const codeContextAnnotation = filteredAnnotations.find((annotation) => annotation.type === 'codeContext');
  const usageMetadata =
    metadata && typeof metadata === 'object' && 'type' in metadata && metadata.type === 'usage' ? metadata : null;

  const chatSummary: string | undefined = chatSummaryAnnotation?.summary;
  const codeContext: string[] | undefined = codeContextAnnotation?.files;
  const usage: {
    completionTokens: number;
    promptTokens: number;
    totalTokens: number;
  } = (usageMetadata as any)?.value;

  return (
    <div className="overflow-hidden w-full pb-[14px]">
      <>
        <div className="flex gap-2 items-center text-sm text-bolt-elements-textSecondary mb-2">
          {(codeContext || chatSummary) && (
            <Popover side="right" align="start" trigger={<div className="i-ph:info" />}>
              {chatSummary && (
                <div className="max-w-chat">
                  <div className="summary max-h-96 flex flex-col">
                    <h2 className="border border-bolt-elements-borderColor rounded-md p4">Summary</h2>
                    <div style={{ zoom: 0.7 }} className="overflow-y-auto m4">
                      <Markdown>{chatSummary}</Markdown>
                    </div>
                  </div>
                  {codeContext && (
                    <div className="code-context flex flex-col p4 border border-bolt-elements-borderColor rounded-md">
                      <h2>Context</h2>
                      <div className="flex gap-4 mt-4 bolt" style={{ zoom: 0.6 }}>
                        {codeContext.map((x, index) => {
                          const normalized = normalizedFilePath(x);
                          return (
                            <React.Fragment key={normalized || index}>
                              <code
                                className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openArtifactInWorkbench(normalized);
                                }}
                              >
                                {normalized}
                              </code>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="context"></div>
            </Popover>
          )}
          {usage && (
            <div>
              Tokens: {usage.totalTokens} (prompt: {usage.promptTokens}, completion: {usage.completionTokens})
            </div>
          )}
        </div>
      </>
      <div className="markdown-container text-body-md-regular-relaxed">
        <div
          className={expanded ? 'markdown-content' : 'markdown-content-collapsed'}
          style={
            !expanded
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  position: 'relative',
                }
              : {}
          }
        >
          <Markdown html>{content}</Markdown>
        </div>
      </div>
    </div>
  );
});
