---
name: job-hunt
description: Fast multi-source job/internship search for Chinese internet companies
---

# Job Hunt — 互联网大厂求职搜索

Search for jobs across multiple platforms simultaneously. Targets AI product, fintech, operations, and related roles at major Chinese tech companies.

## Workflow

### Step 1: Understand what the user wants
- **Keyword**: e.g. AI产品运营, 金融科技, 商业分析
- **Job type**: 暑期实习 (default), 校招, 日常实习
- **Companies**: 腾讯, 字节跳动, 阿里, 蚂蚁, 美团, 百度... (default: all)
- **City**: 深圳, 北京, 上海, 杭州... (optional)

### Step 2: Multi-pronged search

Run ALL of the following in parallel:

**A) WebFetch — direct job board searches**
These are the most reliable. Fetch and parse for job listings:

```
https://www.shixiseng.com/interns?keyword={URL_ENCODED_KEYWORD}
https://www.nowcoder.com/jobs?query={URL_ENCODED_KEYWORD}
```

**B) Company career pages — direct URLs**
Open in browser or fetch:
- 腾讯: https://join.qq.com/post.html
- 字节: https://jobs.bytedance.com/campus
- 蚂蚁: https://talent.antgroup.com/campus
- 阿里: https://campus.alibaba.com
- 美团: https://campus.meituan.com/internship
- 百度: https://talent.baidu.com/jobs/list?recruitType=INTERN

**C) WebSearch (MCP) for broader coverage**
Use the `web_search` MCP tool with targeted queries like:
- `{company} {keyword} {job_type} 2026 招聘`
- `site:shixiseng.com {keyword} {job_type}`
- `site:nowcoder.com {company} {keyword} 面经`

### Step 3: Aggregate and present

Format results as a table:

| 公司 | 岗位 | 类型 | 链接 | 备注 |
|------|------|------|------|------|
| 腾讯 | AI产品经理培训生 | 校招 | link | 8月启动 |
| ... | ... | ... | ... | ... |

### Step 4: Offer additional help
- "需要看某个岗位的详细 JD 吗？"
- "要帮你打开投递页面吗？"
- "需要内推码吗？我可以搜一下"

## Tips

- Job boards (实习僧, 牛客) are JS-rendered so WebFetch may not get full content. Supplement with DDG search.
- 腾讯 AI产品经理培训生 is a special program — check join.qq.com in August
- 蚂蚁 allows unlimited applications — encourage multi-submission
- Always check if the position supports 转正 (conversion to full-time)
