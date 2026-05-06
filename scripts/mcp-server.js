/**
 * Web Search MCP Server — Zero dependencies (Node.js built-ins only)
 *
 * Provides a `web_search` tool for Claude Code users on DeepSeek API,
 * where the native WebSearch tool returns "400 deepseek-reasoner does not
 * support this tool_choice".
 *
 * Backend: DuckDuckGo HTML search (no API key required)
 * Protocol: MCP JSON-RPC over stdio
 */

import readline from 'node:readline';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

let requestId = 1;
function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function rpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}
function rpcNotify() {
  // no-op for now
}

function respond(data) {
  process.stdout.write(data + '\n');
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML search
// ---------------------------------------------------------------------------

async function searchDuckDuckGo(query, maxResults = 10) {
  const url = 'https://html.duckduckgo.com/html/';
  const body = new URLSearchParams({ q: query });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) throw new Error(`DuckDuckGo returned ${resp.status}`);

  const html = await resp.text();
  const results = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const blocks = html
    .split(/<div[^>]*class="[^"]*result__body[^"]*"[^>]*>/i)
    .slice(1);

  for (const block of blocks) {
    if (results.length >= maxResults) break;
    linkRe.lastIndex = 0;
    snippetRe.lastIndex = 0;
    const linkMatch = linkRe.exec(block);
    const snippetMatch = snippetRe.exec(block);
    if (linkMatch) {
      results.push({
        title: linkMatch[2].replace(/<\/?[^>]+>/g, '').trim(),
        url: linkMatch[1].replace(/&amp;/g, '&'),
        snippet: snippetMatch
          ? snippetMatch[1].replace(/<\/?[^>]+>/g, '').trim()
          : '',
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the web using DuckDuckGo. Returns title, URL, and snippet for each result. Use this to find current information, documentation, news, or any web content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        max_results: {
          type: 'number',
          description: 'Maximum results (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
];

const SERVER_INFO = {
  name: 'web-search',
  version: '1.0.0',
};

// ---------------------------------------------------------------------------
// MCP request handlers
// ---------------------------------------------------------------------------

async function handleInitialize(id) {
  return rpcResult(id, {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
  });
}

function handleToolsList(id) {
  return rpcResult(id, { tools: TOOLS });
}

async function handleToolsCall(id, params) {
  const { name, arguments: args } = params;

  if (name !== 'web_search') {
    return rpcError(id, -32601, `Unknown tool: ${name}`);
  }

  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return rpcError(id, -32602, 'Missing required parameter: query');
  }

  const maxResults = Math.min(Number(args?.max_results) || 10, 20);

  try {
    const results = await searchDuckDuckGo(query, maxResults);

    if (results.length === 0) {
      return rpcResult(id, {
        content: [{ type: 'text', text: `No results found for: ${query}` }],
      });
    }

    // Format using the Anthropic-style content block pattern
    const text = results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`,
      )
      .join('\n\n');

    return rpcResult(id, { content: [{ type: 'text', text }] });
  } catch (e) {
    return rpcResult(id, {
      content: [{ type: 'text', text: `Search error: ${e.message}` }],
    });
  }
}

// ---------------------------------------------------------------------------
// Main — read JSON-RPC from stdin, write to stdout
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // skip malformed lines
  }

  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      respond(await handleInitialize(id));
    } else if (method === 'notifications/initialized') {
      // no response needed
    } else if (method === 'tools/list') {
      respond(handleToolsList(id));
    } else if (method === 'tools/call') {
      respond(await handleToolsCall(id, params));
    } else if (method === 'ping') {
      respond(rpcResult(id, {}));
    } else {
      respond(rpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (e) {
    respond(rpcError(id ?? null, -32603, e.message));
  }
});

rl.on('close', () => {
  process.exit(0);
});
