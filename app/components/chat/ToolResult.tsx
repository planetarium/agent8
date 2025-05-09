import { useEffect } from 'react';
import { toolUIStore } from '~/lib/stores/toolUI';
import { useStore } from '@nanostores/react';

export interface ToolResult {
  isError: boolean;
  error?: string;
  result: any;
}

interface ToolResultProps {
  toolResult: ToolResult;
  id: string;
}

export const ToolResult = ({ toolResult, id }: ToolResultProps) => {
  const toolUI = useStore(toolUIStore);
  const currentTool = toolUI.tools?.[id] || {};

  useEffect(() => {
    toolUIStore.set({
      tools: {
        ...toolUIStore.get().tools,
        [id]: { ...currentTool, loaded: true },
      },
    });
  }, []);

  return (
    <>
      <div className={currentTool.expanded ? 'block' : 'hidden'}>
        <div className="mt-2 bg-gray-900 p-4 rounded-md">
          <div className="text-sm">
            <strong className="text-sm text-gray-300">Response:</strong>
            <pre className="block p-2 mt-2 rounded-md bg-gray-800 text-sm">
              {JSON.stringify(toolResult.result, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
};
