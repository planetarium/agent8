import { useStore } from '@nanostores/react';
import Lottie from 'lottie-react';
import { toolUIStore } from '~/lib/stores/toolUI';
import { EXCLUSIVE_3D_DOC_TOOLS, TOOL_NAMES } from '~/utils/constants';
import { checkCircleAnimationData } from '~/utils/animationData';

export interface ToolCall {
  toolName: string;
  toolCallId: string;
  input: Record<string, any>;
}

interface ToolCallProps {
  toolCall: ToolCall;
  id: string;
}

// System tools that should be hidden from UI
const SYSTEM_TOOLS: string[] = [
  TOOL_NAMES.UNKNOWN_HANDLER,
  TOOL_NAMES.INVALID_TOOL_INPUT_HANDLER,
  TOOL_NAMES.SUBMIT_FILE_ACTION,
  TOOL_NAMES.SUBMIT_MODIFY_ACTION,
  TOOL_NAMES.SUBMIT_SHELL_ACTION,
  TOOL_NAMES.SEARCH_FILE_CONTENTS,
  TOOL_NAMES.READ_FILES_CONTENTS,
  ...EXCLUSIVE_3D_DOC_TOOLS,
];

// MCP server name to icon mapping
const MCP_SERVER_ICONS: Record<string, string> = {
  Image: '/icons/Image.svg',
  Cinematic: '/icons/Cinematic.svg',
  Audio: '/icons/Audio.svg',
  Skybox: '/icons/Skybox.svg',
  UI: '/icons/UI.svg',
};

// Linked servers that should use parent server's icon and name
const LINKED_SERVERS: Record<string, string> = {
  Spritesheet: 'Image',
};

// Hidden MCP servers that should not show in UI
const HIDDEN_MCP_SERVERS = ['Crossramp'];

// All MCP server names (including linked servers)
const ALL_MCP_SERVERS = [...Object.keys(MCP_SERVER_ICONS), ...Object.keys(LINKED_SERVERS)];

// Extract MCP server name from tool name (e.g., "Image_generate_image" -> "Image")
const getMcpServerName = (toolName: string): string | null => {
  for (const serverName of ALL_MCP_SERVERS) {
    if (toolName.startsWith(serverName + '_') || toolName === serverName) {
      // If it's a linked server, return the parent server name
      if (LINKED_SERVERS[serverName]) {
        return LINKED_SERVERS[serverName];
      }

      return serverName;
    }
  }

  return null;
};

const getMcpServerIcon = (toolName: string): string => {
  const serverName = getMcpServerName(toolName);

  if (serverName && MCP_SERVER_ICONS[serverName]) {
    return MCP_SERVER_ICONS[serverName];
  }

  return '/icons/Sparkle.svg';
};

export const ToolCall = ({ toolCall, id }: ToolCallProps) => {
  const toolUI = useStore(toolUIStore);
  const currentTool = toolUI.tools?.[id] || {};

  // Hide system tools, only show MCP tools
  const isSystemTool = SYSTEM_TOOLS.includes(toolCall.toolName);

  if (isSystemTool) {
    return null;
  }

  // Hide tools from hidden MCP servers
  const isHiddenMcpTool = HIDDEN_MCP_SERVERS.some(
    (serverName) => toolCall.toolName.startsWith(serverName + '_') || toolCall.toolName === serverName,
  );

  if (isHiddenMcpTool) {
    return null;
  }

  const mcpServerName = getMcpServerName(toolCall.toolName);
  const iconPath = getMcpServerIcon(toolCall.toolName);

  return (
    <div className="flex items-center gap-2 mt-4">
      <div className="text-[20px]">
        {currentTool.loaded ? (
          <div style={{ width: '20px', height: '20px' }}>
            <Lottie animationData={checkCircleAnimationData} loop={false} />
          </div>
        ) : (
          <div className="i-svg-spinners:90-ring-with-bg text-white"></div>
        )}
      </div>
      <div className="flex items-center gap-1 flex-[1_0_0]">
        <span className="text-body-sm text-tertiary">Generate</span>
        <div className="flex items-center gap-0.5">
          <img src={iconPath} alt={mcpServerName || 'Tool'} className="w-5 h-5" />
          <span className="text-body-sm text-secondary">{mcpServerName || toolCall.toolName}</span>
        </div>
      </div>
    </div>
  );
};
