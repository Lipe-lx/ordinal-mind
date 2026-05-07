import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

const COMPAT_TOOLS_STUB = "compat_tools_stub"
const COMPAT_PROMPTS_STUB = "compat_prompts_stub"

export function registerCompatibilityStubs(server: McpServer): void {
  const tool = server.registerTool(
    COMPAT_TOOLS_STUB,
    {
      description: "Compatibility-only hidden tool. Not available for use.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "compatibility stub" }],
      isError: true,
    })
  )
  tool.disable()

  const prompt = server.registerPrompt(
    COMPAT_PROMPTS_STUB,
    {
      description: "Compatibility-only hidden prompt. Not available for use.",
    },
    async () => ({
      messages: [{
        role: "assistant",
        content: {
          type: "text",
          text: "compatibility stub",
        },
      }],
    })
  )
  prompt.disable()
}
