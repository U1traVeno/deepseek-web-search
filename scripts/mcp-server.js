/**
 * Web Search MCP Server — Zero dependencies (Node.js built-ins only)
 *
 * Provides a `web_search` tool for Claude Code users on DeepSeek API,
 * where the native WebSearch tool returns "400 deepseek-reasoner does not
 * support this tool_choice".
 *
 * Backend: Bing HTML search (works from China, no API key required)
 * Protocol: MCP JSON-RPC over stdio
 */

import readline from 'node:readline';

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function rpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

function respond(data) {
  process.stdout.write(data + '\n');
}

// ---------------------------------------------------------------------------
// Bing HTML search
// ---------------------------------------------------------------------------

async function searchBing(query, maxResults = 10) {
  const encoded = encodeURIComponent(query);
  const url = `https://www.bing.com/search?q=${encoded}&setlang=en`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    },
  });

  if (!resp.ok) throw new Error(`Bing returned HTTP ${resp.status}`);

  const html = await resp.text();
  const results = [];

  // Parse <li class="b_algo"> blocks
  const blocks = html.split(/<li class="b_algo"[^>]*>/i).slice(1);

  for (const block of blocks) {
    if (results.length >= maxResults) break;

    // Extract URL and title from <h2><a href="URL">TITLE</a></h2>
    const linkMatch = /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i.exec(block);
    if (!linkMatch) continue;

    const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
    const url = linkMatch[1].replace(/&amp;/g, '&');

    // Skip non-result links
    if (!title) continue;

    // Extract snippet from <div class="b_caption"><p>SNIPPET</p>
    const snippetMatch = /<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, '').replace(/&ensp;/g, ' ').replace(/&#0?183;/g, '·').trim()
      : '';

    results.push({ title, url, snippet });
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
      'Search the web using Bing. Returns title, URL, and snippet for each result. Use this to find current information, documentation, news, or any web content.',
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
  version: '2.0.0',
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
    const results = await searchBing(query, maxResults);

    if (results.length === 0) {
      return rpcResult(id, {
        content: [{ type: 'text', text: `No results found for: ${query}` }],
      });
    }

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
