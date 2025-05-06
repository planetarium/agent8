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
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div className={`${styles.toolResult} ${toolResult.isError ? styles.error : ''}`}>
      <div className={styles.toolResultHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.resultInfo}>
          <span className={styles.resultLabel}>Tool Result</span>
          {toolResult.isError && <span className={styles.errorLabel}>(Error)</span>}
        </div>
        <span className={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className={styles.toolResultContent}>
          <pre>{JSON.stringify(toolResult.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
