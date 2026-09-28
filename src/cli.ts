#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAppServer } from './app-server.js'
import { readCredentials, readHttpConfig } from './config.js'
import { createDeveloperServer } from './developer-server.js'
import { createHttpApp } from './http.js'

async function main() {
  const mode = process.argv[2] ?? 'developer'
  if (mode === '--help' || mode === '-h') {
    process.stdout.write('Usage: convokit-mcp [developer|app|http]\n\n  developer  Public documentation MCP over stdio (default)\n  app        App management MCP over stdio; requires app credentials\n  http       /mcp/developer and optional /mcp/app on port 3333\n\nSee README.md and .env.example for configuration.\n')
    return
  }
  if (mode === 'developer' || mode === 'app') {
    const credentials = mode === 'app' ? readCredentials() : undefined
    const handle = serveStdio(() => credentials ? createAppServer(credentials) : createDeveloperServer(), {
      onerror: () => process.stderr.write('MCP transport error.\n'),
    })
    const stop = () => { void handle.close() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }
  if (mode !== 'http') throw new Error('Unknown mode. Use developer, app, or http.')
  const config = readHttpConfig()
  const runtime = createHttpApp(config)
  const listener = runtime.app.listen(config.port, config.host)
  listener.on('error', () => {
    process.stderr.write('Unable to start MCP HTTP listener. Check HOST and PORT.\n')
    void runtime.close()
    process.exitCode = 1
  })
  listener.on('listening', () => process.stderr.write(`ConvoKit MCP listening at http://${config.host}:${config.port}/mcp/developer\n`))
  const stop = () => {
    listener.closeAllConnections()
    listener.close(() => { void runtime.close() })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unable to start ConvoKit MCP.'}\n`)
  process.exitCode = 1
})
