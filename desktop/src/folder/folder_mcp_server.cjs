const os = require('node:os');
const { folder_tools, run_folder_tool } = require('./folder_tools.cjs');

// The folder speaks MCP, the protocol Alfera already uses for outside tools. Alfera sends one
// JSON-RPC message, this answers it. No port is opened on the computer: the messages arrive over
// the connection the app itself makes to Alfera.
const supported_protocol_versions = ['2025-06-18', '2025-03-26', '2024-11-05'];

// The name the person sees in Alfera: "edit a file in Office-MacBook-Pro".
const computer_name = () => os.hostname().replace(/\.local$/, '');

function describe_tool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties: tool.properties,
      required: tool.required,
      additionalProperties: false,
    },
    annotations: tool.annotations,
  };
}

const answers_by_method = {
  initialize: (_folder, params) => ({
    protocolVersion: supported_protocol_versions.includes(params?.protocolVersion)
      ? params.protocolVersion
      : supported_protocol_versions[0],
    capabilities: { tools: {} },
    serverInfo: { name: 'alfera-desktop-folder', title: computer_name(), version: '1' },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: folder_tools.map(describe_tool) }),
  'tools/call': async (folder, params) => {
    const outcome = await run_folder_tool(folder, params?.name, params?.arguments);
    return { content: [{ type: 'text', text: outcome.text }], isError: outcome.failed };
  },
};

// Returns the JSON-RPC response, or null for a notification, which has no answer.
async function answer_mcp_message(folder, message) {
  if (message?.id === undefined || message?.id === null) return null;
  const answer = answers_by_method[message.method];
  if (!answer) {
    return {
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unknown method ${message.method}` },
    };
  }
  try {
    return { jsonrpc: '2.0', id: message.id, result: await answer(folder, message.params) };
  } catch (error) {
    return { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } };
  }
}

module.exports = { answer_mcp_message, computer_name };
