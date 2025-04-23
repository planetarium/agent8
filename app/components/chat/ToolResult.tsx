import React, { useState } from 'react';
import styles from './ToolResult.module.scss';

interface ToolResultProps {
  children: React.ReactElement<any, 'code'>;
}

export const ToolResult = ({ children }: ToolResultProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  let result, isError;

  try {
    result = JSON.parse(children?.props?.children || '{}').result;
    isError = !!result?.isError;
  } catch {
    result = 'Failed to parse tool result';
    isError = true;
  }

  return (
    <div className={`${styles.toolResult} ${isError ? styles.error : ''}`}>
      <div className={styles.toolResultHeader} onClick={() => setIsExpanded(!isExpanded)}>
        <h4>Tool Result {isError ? '(Error)' : ''}</h4>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </div>
      {isExpanded && (
        <div className={styles.toolResultContent}>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
