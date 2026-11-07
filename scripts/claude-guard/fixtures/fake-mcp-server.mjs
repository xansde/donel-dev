#!/usr/bin/env node
// Minimal stdio MCP server for the guard's tests and bench. It serves the tools
// listed in the JSON file named by FAKE_MCP_TOOLS ([{ name, description }]),
// read on every tools/list, so a test can change a description between seal
// and check (the "rug pull" the inventory must catch).
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'initialize') {
    reply(msg.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
  } else if (msg.method === 'tools/list') {
    const tools = JSON.parse(readFileSync(process.env.FAKE_MCP_TOOLS, 'utf8'));
    reply(msg.id, { tools: tools.map((t) => ({ inputSchema: { type: 'object' }, ...t })) });
  }
});
