"""Deterministic, type-specific resource quality gates."""

from __future__ import annotations


def test_extract_resource_text_reads_top_level_generator_fields():
    from app.services.resource_quality import extract_resource_text

    text = extract_resource_text(
        {
            "type": "explainer",
            "title": "链表",
            "overview": "链表使用离散节点",
            "explanation": "节点通过指针连接。",
            "key_points": ["插入不搬移后续元素"],
        }
    )

    assert "离散节点" in text
    assert "指针连接" in text
    assert "插入不搬移" in text


def test_legacy_reviewer_uses_the_same_top_level_extraction():
    from app.agents.reviewer import _extract_content_text

    text = _extract_content_text(
        {"type": "explainer", "overview": "离散节点", "explanation": "指针连接"}
    )

    assert "离散节点" in text and "指针连接" in text


def test_empty_quiz_and_invalid_python_are_rejected():
    from app.services.resource_quality import review_resource

    quiz = review_resource(
        {"type": "quiz", "questions": []},
        task={"quality_criteria": ["5 道题"], "outline": {"sections": []}},
    )
    code = review_resource(
        {"type": "code", "language": "python", "code": "def broken(:"},
        task={"quality_criteria": ["代码可运行"], "outline": {"sections": []}},
    )

    assert quiz.approved is False and any("题" in issue for issue in quiz.issues)
    assert code.approved is False and any("语法" in issue for issue in code.issues)


def test_outline_coverage_is_scored_against_must_cover_terms():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {"type": "explainer", "overview": "只介绍数组"},
        task={
            "quality_criteria": ["比较数组与链表"],
            "outline": {
                "sections": [{"title": "结构比较", "must_cover": ["数组", "链表"]}],
            },
        },
    )

    assert review.approved is False
    assert review.score < 0.75
    assert any("链表" in issue for issue in review.issues)


def test_mindmap_requires_depth_and_unique_labels():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "mindmap",
            "title": "线性表",
            "nodes": [
                {"label": "存储", "children": []},
                {"label": "存储", "children": []},
            ],
        },
        task={"quality_criteria": ["层次清晰"], "outline": {"sections": []}},
    )

    assert review.approved is False
    assert any("层级" in issue or "重复" in issue for issue in review.issues)


def test_courseware_and_video_require_dense_structured_content():
    from app.services.resource_quality import review_resource

    courseware = review_resource(
        {"type": "courseware", "slides": [{"title": "标题", "content": []}]},
        task={"quality_criteria": ["8 页"], "outline": {"sections": []}},
    )
    video = review_resource(
        {"type": "video", "narration": [{"text": "只有一句", "duration": 5}]},
        task={"quality_criteria": ["60 秒"], "outline": {"sections": []}},
    )

    assert courseware.approved is False and any("课件" in issue for issue in courseware.issues)
    assert video.approved is False and any("旁白" in issue or "时长" in issue for issue in video.issues)


def test_generator_prompt_exposes_must_cover_terms_and_target_words():
    from app.agents.common import prompt_extras

    prompt = prompt_extras(
        {
            "resource_outline": {
                "objective": "解释栈",
                "sections": [
                    {
                        "title": "栈的定义",
                        "goal": "理解后进先出",
                        "must_cover": ["栈定义", "LIFO原则"],
                        "target_words": 180,
                    }
                ],
            }
        }
    )

    assert "栈定义、LIFO原则" in prompt
    assert "180" in prompt


def test_generator_prompt_exposes_approved_dependency_summaries():
    from app.agents.common import prompt_extras

    prompt = prompt_extras(
        {
            "dependency_outputs": [
                {
                    "task_id": "explainer-d1",
                    "title": "数组与链表讲义",
                    "summary": "数组连续存储，链表通过指针连接。",
                }
            ]
        }
    )

    assert "已审核依赖资料" in prompt
    assert "数组与链表讲义" in prompt
    assert "数组连续存储" in prompt


def test_definition_and_principle_terms_accept_clear_semantic_explanations():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种受限线性表",
            "explanation": ("栈是一种只能在表尾操作的线性表，遵循后进先出（LIFO）。" * 8),
        },
        task={
            "type": "explainer",
            "quality_criteria": ["解释准确"],
            "outline": {
                "sections": [
                    {"title": "定义", "must_cover": ["栈定义", "LIFO原则"]}
                ]
            },
        },
    )

    assert review.approved is True


def test_long_must_cover_phrases_accept_markdown_and_connective_words():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种只允许在表尾进行插入和删除操作的受限线性表。",
            "explanation": (
                "- **push**：在栈顶插入一个元素。\n"
                "- **pop**：从栈顶删除并返回一个元素。\n"
                "连续执行 push(A)、push(B)、pop() 时，B 最后进入却最先离开，"
                "这说明栈遵循后进先出的操作顺序（LIFO）。\n"
            )
            * 8,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["准确解释栈的核心操作"],
            "outline": {
                "sections": [
                    {
                        "title": "栈的定义与操作",
                        "must_cover": [
                            "栈是限定仅在表尾插入删除的线性表",
                            "push在栈顶插入",
                            "pop从栈顶删除",
                            "后进先出的操作顺序",
                        ],
                    }
                ]
            },
        },
    )

    assert review.approved is True


def test_quiz_count_understands_practice_question_wording():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "quiz",
            "questions": [
                {
                    "stem": "第一次练习题",
                    "options": ["A. 后进先出", "B. 先进先出"],
                    "answer": "A",
                    "explanation": "栈遵循后进先出原则。",
                },
                {
                    "stem": "第二次练习题",
                    "options": ["A. push", "B. dequeue"],
                    "answer": "A",
                    "explanation": "push 会在栈顶插入元素。",
                },
                {
                    "stem": "不应出现的第三题",
                    "options": ["A. 栈顶", "B. 栈底"],
                    "answer": "A",
                    "explanation": "这道题用于验证题量约束。",
                },
            ],
        },
        task={
            "type": "quiz",
            "quality_criteria": ["包含 2 道练习题"],
            "outline": {"sections": []},
        },
    )

    assert review.approved is False
    assert any("数量应为 2 道" in issue for issue in review.issues)


def test_ascii_operation_code_term_accepts_generated_code_evidence():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈只允许在栈顶进行插入和删除操作。",
            "explanation": (
                "def push(item): stack.append(item)\n"
                "def pop(): return stack.pop()\n"
                "先 push(A)，再 push(B)，调用 pop() 时 B 会先离开。\n"
            )
            * 8,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["包含可执行示例"],
            "outline": {
                "sections": [
                    {"title": "操作示例", "must_cover": ["push/pop代码"]}
                ]
            },
        },
    )

    assert review.approved is True


def test_quiz_fields_satisfy_answer_analysis_and_state_change_requirements():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "quiz",
            "questions": [
                {
                    "type": "mcq",
                    "stem": "依次入栈 A、B 后执行一次 pop，哪个元素先离开？",
                    "options": ["A. A", "B. B"],
                    "answer": "B",
                    "explanation": (
                        "遍历过程：A 入栈后栈内为 [A]，B 入栈后栈顶为 B；"
                        "执行 pop 后 B 先离开，栈内变为 [A]。"
                    ),
                }
            ],
        },
        task={
            "type": "quiz",
            "quality_criteria": ["1 道题"],
            "outline": {
                "sections": [
                    {
                        "title": "答案与解析",
                        "must_cover": ["正确答案", "详细解析", "栈状态变化"],
                    }
                ]
            },
        },
    )

    assert review.approved is True


def test_equivalent_stack_definition_phrasing_satisfies_outline_terms():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种后进先出的线性表。",
            "explanation": (
                "栈限制了数据的操作位置：插入和删除操作只能在表的一端（称为栈顶）进行，"
                "另一端固定不动，称为栈底。栈顶允许压栈和弹栈，栈底不允许直接操作。"
            )
            * 6,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["定义准确"],
            "outline": {
                "sections": [
                    {
                        "title": "定义",
                        "must_cover": [
                            "插入和删除仅在表尾（栈顶）进行",
                            "栈顶、栈底概念",
                        ],
                    }
                ]
            },
        },
    )

    assert review.approved is True


def test_quiz_intent_phrases_accept_equivalent_question_wording():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "quiz",
            "questions": [
                {
                    "type": "mcq",
                    "stem": "入栈序列为 1、2、3、4，哪个出栈序列不可能？",
                    "options": ["A. 4、3、2、1", "B. 4、1、3、2"],
                    "answer": "B",
                    "explanation": "按入栈和出栈过程逐步模拟，选项 B 不符合后进先出。",
                },
                {
                    "type": "mcq",
                    "stem": "使用栈判断表达式 {[()]} 是否匹配，以下描述正确的是？",
                    "options": ["A. 最近的左括号先匹配", "B. 最早的左括号先匹配"],
                    "answer": "A",
                    "explanation": "栈的后进先出特性使最近入栈的左括号先与右括号匹配。",
                },
            ],
        },
        task={
            "type": "quiz",
            "quality_criteria": ["必须生成 2 道题"],
            "outline": {
                "sections": [
                        {
                            "title": "顺序判断",
                            "must_cover": [
                                "给定push顺序",
                                "给定pop顺序",
                                "判断是否可能",
                                "栈的push/pop顺序",
                            ],
                    },
                    {
                        "title": "括号匹配",
                        "must_cover": [
                            "括号匹配问题",
                            "栈的后进先出如何解决",
                            "给出匹配判断",
                        ],
                    },
                ]
            },
        },
    )

    assert review.approved is True


def test_scattered_unordered_characters_do_not_satisfy_a_must_cover_term():
    from app.services.resource_quality import is_term_covered

    assert is_term_covered("数据结构原理", "理原构结据数" * 30) is False


def test_explainer_quality_criteria_require_requested_examples():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种后进先出的线性表。",
            "explanation": "栈只允许在栈顶插入和删除元素，因此后进入的元素会先离开。" * 10,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["至少包含一个生活类比"],
            "outline": {
                "sections": [
                    {"title": "定义", "must_cover": ["栈定义", "后进先出"]}
                ]
            },
        },
    )

    assert review.approved is True
    assert any("类比" in warning for warning in review.warnings)


def test_explainer_quality_criteria_require_requested_sources():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种后进先出的线性表。",
            "explanation": "例如叠盘子时最后放上去的盘子最先拿走，这就是后进先出。" * 10,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["引用知识库来源"],
            "outline": {
                "sections": [
                    {"title": "定义", "must_cover": ["栈定义", "后进先出"]}
                ]
            },
        },
    )

    assert review.approved is True
    assert any("来源" in warning for warning in review.warnings)


def test_quality_criteria_enforce_complexity_comparison_and_code_boundaries():
    from app.services.resource_quality import review_resource

    explainer = review_resource(
        {
            "type": "explainer",
            "overview": "数组和链表都是线性表。",
            "explanation": "数组连续存储，链表通过指针连接，两者适用于不同场景。" * 10,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["给出复杂度对比"],
            "outline": {
                "sections": [
                    {"title": "对比", "must_cover": ["数组", "链表"]}
                ]
            },
        },
    )
    code = review_resource(
        {"type": "code", "language": "python", "code": "def top(items):\n    return items[-1]\n"},
        task={
            "type": "code",
            "quality_criteria": ["覆盖异常边界"],
            "outline": {"sections": []},
        },
    )

    assert explainer.approved is True
    assert any("复杂度" in warning for warning in explainer.warnings)
    assert code.approved is True
    assert any("异常边界" in warning for warning in code.warnings)


def test_unknown_quality_criteria_are_not_silently_approved():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种后进先出的线性表。",
            "explanation": "栈只允许在栈顶插入和删除，因此后进入的元素会先离开。" * 10,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["使用竞赛级推导法"],
            "outline": {
                "sections": [
                    {"title": "定义", "must_cover": ["栈定义", "后进先出"]}
                ]
            },
        },
    )

    assert review.approved is True
    assert review.blocking_issues == []
    assert any("无法自动验证" in warning for warning in review.warnings)


def test_numbered_example_criterion_requires_distinct_examples():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "栈是一种后进先出的线性表。",
            "explanation": "例如叠盘子时，最后放上的盘子最先拿走。" * 12,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["至少包含 3 个生活示例"],
            "outline": {
                "sections": [
                    {"title": "定义", "must_cover": ["栈定义", "后进先出"]}
                ]
            },
        },
    )

    assert review.approved is True
    assert any("3" in warning and "示例" in warning for warning in review.warnings)


def test_chinese_number_criteria_are_enforced_for_quizzes_and_pages():
    from app.services.resource_quality import review_resource

    quiz = review_resource(
        {
            "type": "quiz",
            "questions": [
                {
                    "stem": "栈遵循什么顺序？",
                    "options": ["LIFO", "FIFO"],
                    "answer": "LIFO",
                    "explanation": "栈遵循后进先出顺序。",
                }
            ],
        },
        task={"type": "quiz", "quality_criteria": ["两道题"], "outline": {"sections": []}},
    )
    courseware = review_resource(
        {
            "type": "courseware",
            "slides": [
                {"title": f"第 {index} 页", "content": ["内容"]}
                for index in range(8)
            ],
        },
        task={
            "type": "courseware",
            "quality_criteria": ["十二页"],
            "outline": {"sections": []},
        },
    )

    assert quiz.approved is False
    assert any("2" in issue or "两" in issue for issue in quiz.issues)
    assert courseware.approved is False
    assert any("12" in issue or "十二" in issue for issue in courseware.issues)


def test_qualified_counts_accept_distinct_examples_thought_questions_and_sections():
    from app.services.resource_quality import review_resource

    explanation = """
## 1. 栈的定义
栈遵循后进先出原则，只在栈顶进行操作。
## 2. 示例一：叠盘子
叠盘子时后放的盘子先取，对应入栈和出栈。
## 3. 示例二：浏览器后退
最后访问的页面最先后退，对应栈顶元素先弹出。
## 4. 示例三：电梯中的人
后进入且靠近门口的人先出去，对应后进先出。
## 5. 总结与思考
思考题：还有哪些生活场景遵循后进先出？
""" + ("栈顶元素最后进入、最先离开，这就是 LIFO。" * 50)
    review = review_resource(
        {"type": "explainer", "overview": "栈的生活类比", "explanation": explanation},
        task={
            "type": "explainer",
            "quality_criteria": [
                "至少包含3个不同的生活示例",
                "必须包含至少1个思考题",
                "总字数不少于800字",
                "结构层级清晰，包含5个章节",
            ],
            "outline": {"sections": []},
        },
    )

    assert review.approved is True, review.issues


def test_unsupported_large_chinese_counts_fail_closed_without_partial_parsing():
    from app.services.resource_quality import review_resource

    courseware = review_resource(
        {
            "type": "courseware",
            "slides": [
                {"title": f"第 {index} 页", "content": ["内容"]}
                for index in range(8)
            ],
        },
        task={
            "type": "courseware",
            "quality_criteria": ["一百页"],
            "outline": {"sections": []},
        },
    )
    explainer = review_resource(
        {"type": "explainer", "explanation": "栈遵循后进先出原则。" * 40},
        task={
            "type": "explainer",
            "quality_criteria": ["三百字"],
            "outline": {"sections": []},
        },
    )

    assert courseware.approved is True
    assert any("无法自动验证" in warning for warning in courseware.warnings)
    assert explainer.approved is True
    assert any("无法自动验证" in warning for warning in explainer.warnings)


def test_dynamic_programming_formula_variants_are_semantic_must_cover_matches():
    from app.services.resource_quality import is_term_covered

    knapsack = "dp [ i ] [ w ] := max（dp[i - 1][w]，dp[i - 1][w - wi] + vi）"
    lcs = "当字符相等时，dp[i][j] = dp[i-1][j-1] + 1；否则取 max(dp[i-1][j], dp[i][j-1])。"

    assert is_term_covered(
        "01背包状态转移方程：dp[i][w] = max(dp[i-1][w], dp[i-1][w-weight[i]] + value[i])",
        knapsack,
    )
    assert is_term_covered("LCS递推关系", lcs)
    assert is_term_covered("状态转移方程", knapsack)
    assert is_term_covered("边界初始化", "初始化：dp[0][w] = 0，随后按状态转移填表。")
    assert is_term_covered("边界初始化", knapsack) is False


def test_warning_only_quality_findings_do_not_block_an_otherwise_complete_resource():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {
            "type": "explainer",
            "overview": "动态规划通过保存子问题结果避免重复计算。",
            "explanation": "动态规划把问题拆为重叠子问题，再按状态转移逐步求解。" * 12,
        },
        task={
            "type": "explainer",
            "quality_criteria": ["使用竞赛级推导法", "至少包含 3 个生活示例"],
            "outline": {"sections": [{"title": "原理", "must_cover": ["动态规划"]}]},
        },
    )

    assert review.approved is True
    assert review.blocking_issues == []
    assert len(review.warnings) >= 2


def test_real_missing_must_cover_remains_a_blocking_failure():
    from app.services.resource_quality import review_resource

    review = review_resource(
        {"type": "explainer", "explanation": "动态规划通过保存结果避免重复计算。" * 12},
        task={
            "type": "explainer",
            "quality_criteria": ["解释准确"],
            "outline": {"sections": [{"title": "边界", "must_cover": ["边界初始化"]}]},
        },
    )

    assert review.approved is False
    assert any("边界初始化" in issue for issue in review.blocking_issues)


def test_latest_dynamic_programming_failure_requirements_regress_offline():
    """The previously false-negative DP terms pass, but a real gap still blocks."""

    from app.services.resource_quality import review_resource

    explanation = (
        "01 背包的状态转移为 dp[i][w] := max（dp[i-1][w]，dp[i-1][w-wi] + vi）。"
        "LCS 的递推关系是：字符相等时 dp[i][j]=dp[i-1][j-1]+1，"
        "否则取 max(dp[i-1][j], dp[i][j-1])。"
        "边界初始化：dp[0][w]=0，dp[i][0]=0，然后按状态转移方程填表。"
    ) * 5
    task = {
        "type": "explainer",
        "quality_criteria": ["解释准确"],
        "outline": {
            "sections": [
                {
                    "title": "动态规划递推",
                    "must_cover": [
                        "01背包状态转移方程：dp[i][w] = max(dp[i-1][w], dp[i-1][w-weight[i]] + value[i])",
                        "LCS递推关系",
                        "状态转移方程",
                        "边界初始化",
                    ],
                }
            ]
        },
    }

    accepted = review_resource({"type": "explainer", "explanation": explanation}, task)
    missing_boundary = review_resource(
        {"type": "explainer", "explanation": explanation.replace("dp[0][w]=0，dp[i][0]=0，", "")},
        task,
    )

    assert accepted.approved is True, accepted.issues
    assert missing_boundary.approved is False
    assert any("边界初始化" in issue for issue in missing_boundary.blocking_issues)
