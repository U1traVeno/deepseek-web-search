/**
 * Job Search MCP Server — Zero dependencies (Node.js built-ins only)
 *
 * Multi-source parallel job/internship search with aggregation & dedup.
 * Targets: 实习僧, 牛客网, BOSS直聘, 公司官网, general search.
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
// DuckDuckGo search (shared logic)
// ---------------------------------------------------------------------------

async function ddgSearch(query, maxResults = 10) {
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
  const linkRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
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
// Multi-source job search
// ---------------------------------------------------------------------------

// Known company domains for direct searches
const COMPANY_DOMAINS = {
  '腾讯': 'join.qq.com',
  '阿里': 'campus.alibaba.com',
  '字节': 'jobs.bytedance.com',
  '字节跳动': 'jobs.bytedance.com',
  '蚂蚁': 'talent.antgroup.com',
  '蚂蚁集团': 'talent.antgroup.com',
  '美团': 'campus.meituan.com',
  '百度': 'talent.baidu.com',
  '京东': 'campus.jd.com',
  '快手': 'campus.kuaishou.cn',
  '拼多多': 'careers.pinduoduo.com',
  '小红书': 'job.xiaohongshu.com',
  '小米': 'hr.xiaomi.com',
  '网易': 'campus.163.com',
  '华为': 'career.huawei.com',
  '携程': 'campus.ctrip.com',
  '哔哩哔哩': 'campus.bilibili.com',
  'B站': 'campus.bilibili.com',
  '滴滴': 'campus.didiglobal.com',
};

const JOB_SITES = {
  '实习僧': 'shixiseng.com',
  '牛客网': 'nowcoder.com',
  'BOSS直聘': 'zhipin.com',
  '猎聘': 'liepin.com',
  '前程无忧': '51job.com',
};

async function searchSingleSource(query, maxResults) {
  try {
    const results = await ddgSearch(query, maxResults);
    return results.map((r) => ({ ...r, _query: query }));
  } catch {
    return [];
  }
}

function dedupResults(allResults) {
  const seen = new Set();
  const out = [];
  for (const r of allResults) {
    // Dedup by URL (normalized)
    const key = r.url.replace(/\/$/, '').replace(/^https?:\/\//, '');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

async function jobSearch({ keyword, job_type, companies, city, max_results }) {
  const max = Math.min(max_results || 20, 30);

  // Build search queries
  const queries = [];

  // 1. Target each specified company
  const targetCompanies = companies || [];
  for (const company of targetCompanies) {
    const domain = COMPANY_DOMAINS[company];
    if (domain) {
      queries.push(`site:${domain} ${keyword} ${job_type || '实习'}`);
    }
    queries.push(`${company} ${keyword} ${job_type || '实习'} 2026`);
  }

  // 2. Target job boards
  if (!companies || companies.length === 0) {
    for (const [name, domain] of Object.entries(JOB_SITES)) {
      queries.push(
        `site:${domain} ${keyword} ${job_type || '实习'} ${city || ''}`,
      );
    }
  } else {
    // With specific companies, still check job boards
    queries.push(
      `site:shixiseng.com ${keyword} ${job_type || '实习'} ${targetCompanies.join(' ')}`,
    );
    queries.push(
      `site:nowcoder.com ${keyword} ${job_type || '实习'} ${targetCompanies.join(' ')}`,
    );
  }

  // 3. General search for broader coverage
  queries.push(
    `互联网大厂 ${keyword} ${job_type || '暑期实习'} 2026 ${targetCompanies.join(' ')}`,
  );

  // Run all queries in parallel
  const perSource = Math.max(Math.ceil(max / queries.length), 3);

  const allResults = await Promise.all(
    queries.map((q) => searchSingleSource(q, perSource)),
  );

  const merged = dedupResults(allResults.flat());

  // Sort: prioritize results with explicit job titles
  const jobKeywords = [
    '实习',
    '校招',
    '招聘',
    '岗位',
    '产品',
    '运营',
    'AI',
    '人工智能',
  ];
  merged.sort((a, b) => {
    const aScore = jobKeywords.filter((k) => a.title.includes(k)).length;
    const bScore = jobKeywords.filter((k) => b.title.includes(k)).length;
    if (bScore !== aScore) return bScore - aScore;
    return a.title.length - b.title.length; // shorter titles = more focused
  });

  return merged.slice(0, max);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatResults(results, keyword) {
  if (results.length === 0) {
    return `No job listings found for: ${keyword}`;
  }

  const lines = [`## Job Search Results: ${keyword}\n`];

  // Group by source
  const bySource = {};
  for (const r of results) {
    let source = 'General';
    for (const [name, domain] of Object.entries({
      ...COMPANY_DOMAINS,
      ...JOB_SITES,
    })) {
      if (r.url.includes(domain)) {
        source = name;
        break;
      }
    }
    if (!bySource[source]) bySource[source] = [];
    bySource[source].push(r);
  }

  for (const [source, items] of Object.entries(bySource)) {
    lines.push(`### ${source} (${items.length} results)`);
    for (const item of items) {
      lines.push(
        `- **${item.title}**\n  ${item.url}\n  ${item.snippet || ''}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'job_search',
    description:
      'Multi-source job/internship search across job boards and company career sites. ' +
      'Searches 实习僧, 牛客网, BOSS直聘, company official sites in parallel, ' +
      'then deduplicates and sorts results by relevance.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            'Job keyword, e.g. "AI产品运营", "金融科技", "数据分析"',
        },
        job_type: {
          type: 'string',
          description: '实习, 校招, 社招, 暑期实习 (default: 实习)',
        },
        companies: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Target companies, e.g. ["腾讯", "字节跳动", "蚂蚁集团"]. Leave empty for all.',
        },
        city: {
          type: 'string',
          description: 'City filter, e.g. "深圳", "北京", "上海"',
        },
        max_results: {
          type: 'number',
          description: 'Maximum total results (default: 20, max: 30)',
        },
      },
      required: ['keyword'],
    },
  },
];

const SERVER_INFO = { name: 'job-search', version: '1.0.0' };

// ---------------------------------------------------------------------------
// MCP handlers
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

  if (name !== 'job_search') {
    return rpcError(id, -32601, `Unknown tool: ${name}`);
  }

  const keyword = args?.keyword;
  if (!keyword || typeof keyword !== 'string') {
    return rpcError(id, -32602, 'Missing required parameter: keyword');
  }

  try {
    const results = await jobSearch({
      keyword,
      job_type: args?.job_type || '实习',
      companies: args?.companies || [],
      city: args?.city || '',
      max_results: args?.max_results || 20,
    });

    const text = formatResults(results, keyword);
    return rpcResult(id, { content: [{ type: 'text', text }] });
  } catch (e) {
    return rpcResult(id, {
      content: [{ type: 'text', text: `Job search error: ${e.message}` }],
    });
  }
}

// ---------------------------------------------------------------------------
// Main
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
    return;
  }

  const { id, method, params } = msg;

  try {
    if (method === 'initialize') {
      respond(await handleInitialize(id));
    } else if (method === 'notifications/initialized') {
      // no response
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

rl.on('close', () => process.exit(0));
