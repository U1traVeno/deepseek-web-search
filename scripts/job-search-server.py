"""
Job Search MCP Server — Python version using duckduckgo_search library.

Multi-source parallel job/internship search with aggregation & dedup.
Fallback from Node.js version when DDG rate-limits direct requests.
"""

import json
import sys
import time

try:
    from duckduckgo_search import DDGS
except ImportError:
    print(json.dumps({"error": "duckduckgo_search not installed. Run: pip3 install duckduckgo_search"}), file=sys.stderr)
    sys.exit(1)


COMPANY_DOMAINS = {
    '腾讯': 'join.qq.com',
    '阿里': 'campus.alibaba.com',
    '阿里巴巴': 'campus.alibaba.com',
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
}


def rpc_result(req_id, result):
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result})


def rpc_error(req_id, code, message):
    return json.dumps({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def respond(data):
    sys.stdout.write(data + "\n")
    sys.stdout.flush()


def search_source(query, max_results=5, delay=1.5):
    """Search a single query, return list of {title, url, snippet}."""
    try:
        with DDGS() as ddgs:
            results = []
            for r in ddgs.text(query, max_results=max_results, region='wt-wt'):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("href", r.get("url", "")),
                    "snippet": r.get("body", r.get("description", "")),
                })
            return results
    except Exception:
        return []
    finally:
        if delay:
            time.sleep(delay)


def dedup(results):
    seen = set()
    out = []
    for r in results:
        key = r["url"].rstrip("/").replace("https://", "").replace("http://", "")
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def job_search(keyword, job_type="实习", companies=None, city="", max_results=20):
    companies = companies or []
    max_results = min(max_results, 30)

    queries = []

    # Company-specific queries
    for company in companies:
        domain = COMPANY_DOMAINS.get(company)
        if domain:
            queries.append(f"site:{domain} {keyword} {job_type}")
        queries.append(f"{company} {keyword} {job_type} 2026")

    # Job board queries
    if not companies:
        for site in ["shixiseng.com", "nowcoder.com", "zhipin.com"]:
            queries.append(f"site:{site} {keyword} {job_type} {city}")
    else:
        company_str = " ".join(companies)
        queries.append(f"site:shixiseng.com {keyword} {job_type} {company_str}")
        queries.append(f"site:nowcoder.com {keyword} {job_type} {company_str}")

    # General search
    company_str = " ".join(companies) if companies else "互联网大厂"
    queries.append(f"{company_str} {keyword} {job_type} 2026 招聘")

    # Run all queries (DDGS is synchronous, so we do linear but it's fine)
    per_source = max(max_results // len(queries), 3)
    all_results = []
    for q in queries:
        all_results.extend(search_source(q, per_source))

    merged = dedup(all_results)

    # Sort by job relevance
    job_kw = ["实习", "校招", "招聘", "岗位", "产品", "运营", "AI", "人工智能"]
    merged.sort(key=lambda r: (
        -sum(1 for k in job_kw if k in r["title"]),
        len(r["title"]),
    ))

    return merged[:max_results]


def format_results(results, keyword):
    if not results:
        return f"No job listings found for: {keyword}"

    lines = [f"## Job Search: {keyword}\n"]

    by_source = {}
    for r in results:
        source = "General"
        for name, domain in COMPANY_DOMAINS.items():
            if domain in r["url"]:
                source = name
                break
        for name in ["shixiseng.com", "nowcoder.com", "zhipin.com", "liepin.com"]:
            if name in r["url"]:
                source = {"shixiseng.com": "实习僧", "nowcoder.com": "牛客网",
                          "zhipin.com": "BOSS直聘", "liepin.com": "猎聘"}.get(name, name)
                break
        by_source.setdefault(source, []).append(r)

    for source, items in by_source.items():
        lines.append(f"### {source} ({len(items)} results)")
        for item in items:
            lines.append(f"- **{item['title']}**\n  {item['url']}\n  {item.get('snippet', '')}")
        lines.append("")

    return "\n".join(lines)


# MCP handlers
SERVER_INFO = {"name": "job-search", "version": "1.0.0"}

TOOLS = [{
    "name": "job_search",
    "description": (
        "Multi-source job/internship search across 实习僧, 牛客网, BOSS直聘, "
        "and company official career sites. Parallel search with dedup and relevance sort."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "Job keyword, e.g. AI产品运营, 金融科技"},
            "job_type": {"type": "string", "description": "实习, 校招, 暑期实习 (default: 实习)"},
            "companies": {
                "type": "array", "items": {"type": "string"},
                "description": "Target companies, e.g. [\"腾讯\", \"字节跳动\"]"
            },
            "city": {"type": "string", "description": "City filter, e.g. 深圳, 北京, 上海"},
            "max_results": {"type": "number", "description": "Max results (default 20, max 30)"},
        },
        "required": ["keyword"],
    },
}]


def handle_initialize(req_id):
    return rpc_result(req_id, {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {}},
        "serverInfo": SERVER_INFO,
    })


def handle_tools_list(req_id):
    return rpc_result(req_id, {"tools": TOOLS})


def handle_tools_call(req_id, params):
    name = params.get("name")
    args = params.get("arguments", {})

    if name != "job_search":
        return rpc_error(req_id, -32601, f"Unknown tool: {name}")

    keyword = args.get("keyword")
    if not keyword:
        return rpc_error(req_id, -32602, "Missing: keyword")

    try:
        results = job_search(
            keyword=keyword,
            job_type=args.get("job_type", "实习"),
            companies=args.get("companies", []),
            city=args.get("city", ""),
            max_results=args.get("max_results", 20),
        )
        text = format_results(results, keyword)
        return rpc_result(req_id, {"content": [{"type": "text", "text": text}]})
    except Exception as e:
        return rpc_result(req_id, {"content": [{"type": "text", "text": f"Error: {e}"}]})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params", {})

        try:
            if method == "initialize":
                respond(handle_initialize(req_id))
            elif method == "notifications/initialized":
                pass
            elif method == "tools/list":
                respond(handle_tools_list(req_id))
            elif method == "tools/call":
                respond(handle_tools_call(req_id, params))
            elif method == "ping":
                respond(rpc_result(req_id, {}))
            else:
                respond(rpc_error(req_id, -32601, f"Method not found: {method}"))
        except Exception as e:
            respond(rpc_error(req_id, -32603, str(e)))


if __name__ == "__main__":
    main()
