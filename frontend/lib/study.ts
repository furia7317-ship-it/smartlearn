/** 学习路径详情页的内容与工具：分节资料、章节测验、离线答疑、掌握度配色。
 *  内容围绕《数据结构·动态规划》主线，保证演示自洽且可离线运行。 */

export interface StudySection {
  id: string;
  day: string;
  title: string;
  /** markdown 正文（可被框选 → AI 解释） */
  body: string;
  /** 关联资源卡（取自 scenario.RESOURCES 的 id） */
  resourceIds: string[];
}

export const STUDY_SECTIONS: StudySection[] = [
  {
    id: "s1",
    day: "D1",
    title: "递归思维回炉（上）",
    resourceIds: ["video_dp"],
    body: `动态规划（DP）的前提只有一句话：**大问题能拆成和它同形的小问题**。卡在 DP 上，往往不是 DP 难，而是递归的直觉没建立。

先看反例 —— 朴素递归求斐波那契，慢得离谱：

\`\`\`python
def fib(n):                 # O(2^n)，fib(40) 要算两亿次
    if n <= 2: return 1
    return fib(n - 1) + fib(n - 2)
\`\`\`

为什么慢？因为 \`fib(20)\` 这种**子问题被反复重算**了上万次。这就是 DP 要解决的核心痛点——**重叠子问题**。

> **今日目标**：能说清「为什么朴素递归慢」，并指出哪些子问题被重复计算。先看右侧动画建立直觉。`,
  },
  {
    id: "s2",
    day: "D2",
    title: "从递归到 DP 表",
    resourceIds: ["explainer_dp"],
    body: `既然慢在重复计算，思路就一句话：**算过的子问题，把答案记下来**。两种等价写法：

**记忆化（自顶向下）** —— 保留递归，加一张缓存表：

\`\`\`python
from functools import lru_cache
@lru_cache(maxsize=None)
def fib(n):
    if n <= 2: return 1
    return fib(n-1) + fib(n-2)     # 每个 n 只真正算一次
\`\`\`

**递推填表（自底向上）** —— 直接从小到大填表，连递归都省了：

\`\`\`python
def fib(n):
    dp = [0, 1, 1] + [0]*(n-2)
    for i in range(3, n+1):
        dp[i] = dp[i-1] + dp[i-2]
    return dp[n]
\`\`\`

两者都把 O(2ⁿ) 降到 **O(n)**。记住：**记忆化递归 ≈ 递推填表**，只是方向不同。

> **今日目标**：能把任意朴素递归改写成记忆化或递推两种 DP 写法。`,
  },
  {
    id: "s3",
    day: "D3",
    title: "DP 五步法",
    resourceIds: ["mindmap_dp"],
    body: `任何 DP 题，按这**五步**走就不会乱：

1. **定义状态**：\`dp[i]\` 表示什么（说人话）
2. **转移方程**：\`dp[i]\` 怎么由更小的状态推出来
3. **边界**：最小的子问题答案是多少
4. **计算顺序**：先算谁后算谁，保证用到时已就绪
5. **空间优化**：能不能把二维压成一维

以**爬楼梯**为例，每次走 1 或 2 级：

\`\`\`text
dp[n] = dp[n-1] + dp[n-2]      ← 这一行就是状态转移方程
\`\`\`

对照右侧**思维导图**把五步走一遍。状态定义对了，题就解了一半。

> **今日目标**：拿到一道新题，能套五步法写出状态定义与转移方程。`,
  },
  {
    id: "s4",
    day: "D4",
    title: "经典模型实操：爬楼梯 → 0-1 背包",
    resourceIds: ["code_dp"],
    body: `今天动手把两个最经典的模型敲一遍。

**爬楼梯**（一维）：\`dp[n] = dp[n-1] + dp[n-2]\`，可用滚动变量把空间压到 O(1)。

**0-1 背包**：\`dp[i][w]\` = 前 i 件、容量 w 的最大价值。第 i 件二选一：

- 不选 → \`dp[i-1][w]\`
- 选 → \`dp[i-1][w-wᵢ] + vᵢ\`

取两者较大。一维压缩时，容量要**逆序**遍历，避免同一件物品被选多次。

打开右侧**代码案例**，把 TODO 补全、跑通单元测试。

> **今日目标**：独立写出 0-1 背包的一维解法，并解释「为什么容量要逆序」。`,
  },
  {
    id: "s5",
    day: "D5",
    title: "专属题库实战",
    resourceIds: ["quiz_dp"],
    body: `是骡子是马拉出来遛遛。今天**限时**完成专属练习卷，检验前四天的成果。

做题节奏建议：

- 选择 / 填空题控制在 1-2 分钟一题
- 卡住先写出「状态定义」，往往就有思路
- 不确定的先标记，做完回头看

做完系统会即时判分并把错题归档，明天复盘自动带上。打开右侧**练习卷**开始。

> **今日目标**：限时完成，正确率心里有数；错题不回避。`,
  },
  {
    id: "s6",
    day: "D6",
    title: "错题复盘 + 贪心 vs DP 边界",
    resourceIds: ["reading_dp"],
    body: `最容易踩的坑是**贪心和 DP 不分**。判断口诀：

- 能用**局部最优**一路推到全局最优 → 贪心
- 必须**枚举所有子问题**、子问题还会被复用 → DP

比如「找零钱最少硬币数」，面值不规整时贪心会错，必须 DP。

复盘清单（考前自检）：

- [ ] 状态定义里有没有漏掉维度？
- [ ] 边界 \`dp[0]\` / \`dp[1]\` 设对了吗？
- [ ] 遍历顺序会不会用到还没算的状态？

结合右侧**拓展阅读**，把昨天的错题逐道讲清「错在哪、对应五步法第几步」。明天就上全真模拟测评。

> **今日目标**：能说清每道错题的根因，并归类到五步法的某一步。`,
  },
];

/* ── 章节测验 ── */

export interface QuizOption {
  key: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  knowledgePoint: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  explain: string;
}

export const CHAPTER_QUIZ: QuizQuestion[] = [
  {
    id: "q1",
    knowledgePoint: "DP 适用条件",
    stem: "一个问题能用动态规划求解，通常要同时满足哪两个性质？",
    options: [
      { key: "A", text: "贪心选择性质 + 无后效性" },
      { key: "B", text: "最优子结构 + 重叠子问题" },
      { key: "C", text: "可分治 + 数据有序" },
      { key: "D", text: "状态唯一 + 无环" },
    ],
    answer: "B",
    explain: "DP 的两大前提是**最优子结构**（大问题的最优解由子问题最优解组成）和**重叠子问题**（子问题被反复用到，值得记表）。",
  },
  {
    id: "q2",
    knowledgePoint: "状态转移",
    stem: "爬楼梯每次可走 1 或 2 级，到第 n 级的方法数 dp[n] 的转移方程是？",
    options: [
      { key: "A", text: "dp[n] = dp[n-1] × dp[n-2]" },
      { key: "B", text: "dp[n] = dp[n-1] + 1" },
      { key: "C", text: "dp[n] = dp[n-1] + dp[n-2]" },
      { key: "D", text: "dp[n] = 2 × dp[n-1]" },
    ],
    answer: "C",
    explain: "到第 n 级只能从第 n-1 级（走1步）或第 n-2 级（走2步）上来，故 dp[n]=dp[n-1]+dp[n-2]。",
  },
  {
    id: "q3",
    knowledgePoint: "0-1 背包",
    stem: "0-1 背包中 dp[i][w] 表示前 i 件、容量 w 的最大价值。「不选第 i 件」对应哪一项？",
    options: [
      { key: "A", text: "dp[i-1][w]" },
      { key: "B", text: "dp[i-1][w-wi] + vi" },
      { key: "C", text: "dp[i][w-1]" },
      { key: "D", text: "dp[i-1][w] + vi" },
    ],
    answer: "A",
    explain: "不选第 i 件，价值和容量都不变，直接继承前 i-1 件的结果 dp[i-1][w]。",
  },
  {
    id: "q4",
    knowledgePoint: "记忆化",
    stem: "记忆化搜索相比朴素递归，关键改进在于？",
    options: [
      { key: "A", text: "改用循环代替递归" },
      { key: "B", text: "把已算过的子问题结果缓存，避免重复计算" },
      { key: "C", text: "减少了状态的数量" },
      { key: "D", text: "提高了递归深度上限" },
    ],
    answer: "B",
    explain: "记忆化把子问题的解存进表，再遇到同一子问题直接查表，把指数级的重复计算降到线性。",
  },
];

/* ── 离线答疑（无后端时的兜底解释，关键词命中 + 通用兜底） ── */

const EXPLAIN_RULES: { kw: RegExp; md: string }[] = [
  {
    kw: /重叠子问题|重复计算|重复算/,
    md: "**重叠子问题**指同一个子问题在递归里被反复求解。比如朴素 `fib(n)` 中 `fib(20)` 被算上万次——把它的结果记进表（记忆化/递推），就从 O(2ⁿ) 降到 O(n)。",
  },
  {
    kw: /最优子结构/,
    md: "**最优子结构**指大问题的最优解可以由子问题的最优解拼出来。背包、最短路都满足；而「最长不下降子序列的个数」类问题要小心，定义不对就不满足。",
  },
  {
    kw: /状态转移|转移方程/,
    md: "**状态转移方程**描述当前状态怎么由更小的状态推出。写法套路：先想 `dp[i]` 的含义，再问「它能从哪些前序状态转移过来、代价是多少」。爬楼梯就是 `dp[n]=dp[n-1]+dp[n-2]`。",
  },
  {
    kw: /背包/,
    md: "**0-1 背包**：`dp[i][w]` = 前 i 件、容量 w 的最大价值。对第 i 件二选一——不选 `dp[i-1][w]`，选 `dp[i-1][w-wᵢ]+vᵢ`，取较大者。一维压缩时容量要**逆序**遍历。",
  },
  {
    kw: /记忆化/,
    md: "**记忆化搜索** = 递归 + 缓存。保留自顶向下的写法，但每个子问题只算一次，结果存表，再次遇到直接返回。等价于递推 DP，但更贴近思考顺序。",
  },
  {
    kw: /贪心/,
    md: "**贪心 vs DP**：能用局部最优一路推到全局（如活动选择）就贪心；必须枚举子问题且子问题复用（如不规整面值找零）就 DP。拿不准时先怀疑贪心会反例。",
  },
];

export function cannedExplain(query: string): string {
  const q = query.replace(/^(请)?解释[:：]?/, "").trim();
  for (const r of EXPLAIN_RULES) {
    if (r.kw.test(query)) {
      return `针对「${q.slice(0, 24)}${q.length > 24 ? "…" : ""}」：\n\n${r.md}\n\n> 依据：08-动态规划.md`;
    }
  }
  return `针对「${q.slice(0, 24)}${q.length > 24 ? "…" : ""}」：这是动态规划里的常见概念。核心抓三点——**状态怎么定义、怎么从小状态转移、边界是什么**。先在讲义对应小节定位它的定义，再用一个最小例子（如爬楼梯）套一遍五步法，理解会快很多。\n\n> 依据：08-动态规划.md`;
}

/* ── 掌握度配色：越高越深（绿系，亮度随掌握度下降、饱和度上升） ── */

export function masteryColor(score: number): string {
  const s = Math.max(0, Math.min(1, score));
  const light = 72 - s * 40; // 72% → 32%
  const sat = 28 + s * 38; // 28% → 66%
  return `hsl(152 ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

export function masteryLabel(score: number): string {
  if (score >= 0.9) return "完全掌握";
  if (score >= 0.75) return "熟练掌握";
  if (score >= 0.6) return "基本掌握";
  if (score >= 0.4) return "初步了解";
  return "待加强";
}
