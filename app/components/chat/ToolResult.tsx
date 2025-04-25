import { useState } from 'react';
import styles from './ToolResult.module.scss';

export interface ToolResult {
  isError: boolean;
  error?: string;
  result: any;
}

interface ToolResultProps {
  toolResult: ToolResult;
}

export const ToolResult = ({ toolResult }: ToolResultProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`${styles.toolResult} ${toolResult.isError ? styles.error : ''}`}>
      <div className={styles.toolResultHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <h4>Tool Result {toolResult.isError ? '(Error)' : ''}</h4>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className={styles.toolResultContent}>
          <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
