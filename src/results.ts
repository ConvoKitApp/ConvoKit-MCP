import type { CallToolResult } from '@modelcontextprotocol/server'

export function result(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

export function failure(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
