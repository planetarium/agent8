import { useStore } from '@nanostores/react';
import { toolUIStore } from '~/lib/stores/toolUI';
import classNames from 'clsx';
export interface ToolCall {
  toolName: string;
  toolCallId: string;
  args: Record<string, any>;
}

interface ToolCallProps {
  toolCall: ToolCall;
  id: string;
}

export const ToolCall = ({ toolCall, id }: ToolCallProps) => {
  const toolUI = useStore(toolUIStore);
  const currentTool = toolUI.tools?.[id] || {};

  return (
    <>
      <div>
        <div
          className={'flex items-center text-gray-400 hover:text-gray-300 cursor-pointer'}
          onClick={() => {
            toolUIStore.set({
              tools: {
                ...toolUIStore.get().tools,
                [id]: { ...currentTool, expanded: !currentTool.expanded },
              },
            });
          }}
        >
          {currentTool.loaded ? (
            <div className="i-ph:check"></div>
          ) : (
            <div className="i-svg-spinners:90-ring-with-bg"></div>
          )}
          <span className="ml-2">{toolCall.toolName}</span>
          <span
            className={classNames(
              'ml-1 text-xs mt-0.5',
              currentTool.expanded ? 'i-ph:caret-down-bold' : 'i-ph:caret-right-bold',
            )}
          ></span>
        </div>
        {currentTool.expanded && (
          <div className="mt-2 bg-gray-900 p-4 rounded-md">
            <div className="text-sm">
              <strong className="text-sm text-gray-300">Parameters:</strong>
              <pre className="block p-2 mt-2 rounded-md bg-gray-800 text-sm overflow-auto max-h-64">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
