/** Public credentials for the explicitly provisioned demonstration account. */
export const DEMO_ACCOUNT = { login: "furia", password: "Furia@2026" } as const;
export const WELCOME_NOTICE_VERSION = "2026-09-14-student";
export const REPLAY_GUIDE_EVENT = "sl:replay-welcome-guide";

export const GUIDE_CHAPTERS = [
  { title: "从目标开始", subtitle: "先安排好下一步，再一步步走远。", body: "告诉学枢你的专业、学习偏好和近期目标。智能教师会结合这些信息，帮助你安排适合当前基础的学习内容。", points: ["建立属于自己的学习档案", "确定一个近期想掌握的主题", "在学习路径中制定课程安排"], note: "目标和偏好都可以在设置中调整。" },
  { title: "安排每天的学习", subtitle: "今天学什么，回到首页就知道。", body: "首页把今日安排、学习分析与成长记录放在一起。先完成今天的一项任务，再看看哪些知识点值得复习。", points: ["今日安排：继续课程、完成待办", "学习分析：查看趋势和薄弱知识", "成长记录：回看学习与能力变化"], note: "今日计划下方的导航栏可以快速跳到这三个部分。" },
  { title: "在动手中掌握", subtitle: "学过的知识，需要亲自用一次。", body: "实训中心提供编程、代码补全和问题排查等任务。可以使用 Java、Python、C、C++，通过运行与提交检验自己的理解。", points: ["选择任务，阅读要求与测试用例", "编写代码、运行并查看反馈", "提交后的答题表现会成为学习证据"], note: "课程考试也可以选择题型，试卷与答题记录会归档。" },
  { title: "把资料收进书架", subtitle: "需要的时候，翻开就能找到。", body: "资源中心保存讲义、练习、导图与视频等学习资料。可以请 AI 生成新资料，也可以在知识库中管理供教师参考的内容。", points: ["点击大书封面，展开资源目录", "选择资料，预览或继续学习", "书架第二本书：进入试卷中心"], note: "试卷中心会保留每次考试的试卷、答案与答题记录。" },
  { title: "看见自己的进步", subtitle: "知识点的掌握，来自学习的积累。", body: "个人主页汇总学习记录、学习画像和知识图谱。图谱中的气泡代表知识点，右侧会展示掌握度、教师判断与阶段建议。", points: ["点击左下角头像，进入个人主页", "点击知识气泡，查看具体知识点", "拖动气泡，观察相关知识之间的联系"], note: "新账号会随学习、练习、考试与实训逐步积累证据，不会直接套用演示画像。" },
  { title: "随时向教师提问", subtitle: "不必等到完全想明白，才开始提问。", body: "页面右下角的智能教师可以讲解当前内容、帮助规划学习，也能结合已有学习记录给出更适合你的回答和资料。", points: ["说清楚正在学习的主题", "描述卡住的步骤或贴出代码", "按建议练习，再回看自己的进步"], note: "引导结束后，也可以从左下角账号菜单重新打开这本手册。" },
] as const;

export const DESKTOP_GUIDE_STEPS = [
  { target: "nav-home", title: "每天从首页开始", text: "在这里查看今日安排、学习分析和成长记录。今日计划下方的导航栏可以快速跳转，先从一项小任务开始。", action: "今日安排" },
  { target: "nav-path", title: "先为目标安排一条路径", text: "选择学习主题和目标，确认自己的基础，再生成课程安排。课程学习、复习和考试都可以从这里继续。", action: "学习路径" },
  { target: "nav-training", title: "把理解变成实际能力", text: "进入实训中心选择任务，编写、运行和提交代码。Java、Python、C、C++ 都可以使用，答题结果会参与掌握度判断。", action: "实训中心" },
  { target: "nav-resources", title: "资料和试卷，都在书架里", text: "翻开大书查看学习资料；左侧可以生成资料、进入知识库。下方第二本书通向试卷中心，可查看历次考试与答题记录。", action: "资源中心" },
  { target: "nav-discover", title: "换一种方式探索知识", text: "在发现中浏览学习市场和讲解剧场。进入二级页面后，可以使用返回入口继续探索。", action: "发现" },
  { target: "profile", title: "这里记录着你的成长", text: "直接点击左下角头像进入个人主页，查看学习画像与知识点掌握图谱。旁边的箭头菜单可以修改设置、调整音效或重看引导。", action: "个人主页" },
  { target: "teacher", title: "带着第一个问题出发", text: "点击右下角的智能教师，试着说：“我想开始学习数据结构，请根据我的基础帮我规划。”你也可以先去学习路径，确定今天的第一步。", action: "智能教师" },
] as const;

export function guideCardPosition(rect: { left: number; right: number; top: number; bottom: number } | null, width: number, height: number, cardHeight: number) {
  const cardWidth = Math.min(390, width - 32);
  const preferredLeft = rect && rect.right + cardWidth + 28 < width ? rect.right + 20 : (rect ? rect.left - cardWidth - 20 : (width - cardWidth) / 2);
  return {
    left: Math.max(16, Math.min(width - cardWidth - 16, preferredLeft)),
    top: Math.max(16, Math.min(height - cardHeight - 16, rect ? (rect.top + rect.bottom - cardHeight) / 2 : (height - cardHeight) / 2)),
    width: cardWidth,
  };
}
