import type { GitlabIssue } from '~/lib/persistenceGitbase/types';

const AGENTIC_LABEL = 'agentic';

interface TaskDetailProps {
  issue: GitlabIssue;
  onBack: () => void;
}

export function TaskDetail({ issue, onBack }: TaskDetailProps) {
  const getLabelColor = (label: string) => {
    // Define specific colors for common label types
    const labelColors: Record<string, string> = {
      TODO: '#F59E0B', // Orange/Amber - warning color
      WIP: '#10B981', // Green - in progress
      'CONFIRM NEEDED': '#3B82F6', // Blue - needs confirmation
      DONE: '#6B7280', // Gray - completed
      REJECT: '#EF4444', // Red - rejected/cancelled
    };

    // Return predefined color if exists, otherwise use a muted default
    return labelColors[label] || '#8B5CF6'; // Purple for other labels
  };

  const getStatusColor = (issue: GitlabIssue) => {
    const filteredLabels = issue.labels?.filter((label) => label !== AGENTIC_LABEL) || [];

    // No labels or TODO: Gray
    if (filteredLabels.length === 0 || filteredLabels.includes('TODO')) {
      return 'bg-gray-500';
    }

    // WIP: Green
    if (filteredLabels.includes('WIP')) {
      return 'bg-green-500';
    }

    // CONFIRM NEEDED: Blue
    if (filteredLabels.includes('CONFIRM NEEDED')) {
      return 'bg-blue-500';
    }

    // REJECT: Red
    if (filteredLabels.includes('REJECT')) {
      return 'bg-red-500';
    }

    // DONE: Gray
    if (filteredLabels.includes('DONE')) {
      return 'bg-gray-500';
    }

    // Default: Green
    return 'bg-green-500';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-6 border-b border-bolt-elements-borderColor">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary border border-bolt-elements-borderColor rounded-md hover:bg-bolt-elements-background-depth-3 hover:border-bolt-elements-borderColorAccent transition-all duration-200 text-sm font-medium"
          >
            <div className="i-ph:arrow-left w-4 h-4" />
            <span>Back to Tasks</span>
          </button>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${getStatusColor(issue)}`}></div>
            <span className="text-sm font-semibold text-bolt-elements-textPrimary">#{issue.iid}</span>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-bolt-elements-textPrimary mb-4">{issue.title}</h1>

        {/* Status */}
        {issue.labels && issue.labels.filter((label) => label !== AGENTIC_LABEL).length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {issue.labels
              .filter((label) => label !== AGENTIC_LABEL)
              .map((label) => (
                <span
                  key={label}
                  className="px-3 py-1 text-sm rounded-full text-white font-medium"
                  style={{ backgroundColor: getLabelColor(label) }}
                >
                  {label}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-2">Created</h3>
              <p className="text-sm text-bolt-elements-textPrimary">{formatDate(issue.created_at)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-2">Updated</h3>
              <p className="text-sm text-bolt-elements-textPrimary">{formatDate(issue.updated_at)}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-2">Author</h3>
              <p className="text-sm text-bolt-elements-textPrimary">{issue.author?.name || 'Unknown'}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-2">State</h3>
              <p className="text-sm text-bolt-elements-textPrimary capitalize">{issue.state}</p>
            </div>
          </div>

          {/* Description */}
          {issue.description && (
            <div>
              <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-3">Description</h3>
              <div className="bg-bolt-elements-background-depth-1 rounded-lg p-4">
                <pre className="text-sm text-bolt-elements-textPrimary whitespace-pre-wrap font-mono">
                  {issue.description}
                </pre>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-bolt-elements-borderColor pt-6">
            <h3 className="text-sm font-medium text-bolt-elements-textSecondary mb-3">Actions</h3>
            <div className="flex gap-3">
              <button
                onClick={() => window.open(issue.web_url, '_blank')}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm font-medium"
              >
                Open in GitLab
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(issue.web_url)}
                className="px-4 py-2 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary border border-bolt-elements-borderColor rounded-md hover:bg-bolt-elements-background-depth-3 transition-colors text-sm font-medium"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
