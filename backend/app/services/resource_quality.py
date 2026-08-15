"""Deterministic quality gates for generated learning resources."""

from __future__ import annotations

import re
import unicodedata
from hashlib import sha256
from typing import Any

from app.schemas.resource_plan import RepairInstruction, TaskReview
from app.services.html_sandbox import strip_html_tags, validate_interactive_payload


QUESTION_RESOURCE_TYPES = {"quiz", "solution"}

TEXT_FIELDS = (
    "title",
    "subtitle",
    "overview",
    "explanation",
    "analogy",
    "content",
    "code",
    "output",
    "summary",
    "description",
    "narration",
)
STRUCTURE_FIELDS = {
    "key_points",
    "nodes",
    "questions",
    "slides",
    "scenes",
    "key_terms",
    "discussion_questions",
    "variations",
    "params",
    "interactions",
}


def extract_resource_text(resource: dict[str, Any]) -> str:
    """Read actual generator output without counting plan metadata as content."""

    parts: list[str] = []

    def collect(value: Any, *, structured: bool = False) -> None:
        if isinstance(value, str):
            if value.strip():
                parts.append(value.strip())
            return
        if isinstance(value, list):
            for item in value:
                collect(item, structured=structured)
            return
        if isinstance(value, dict):
            for key, item in value.items():
                # Interactive demos carry their prose inside markup; review the
                # rendered text, never the tags or the module source.
                if key == "html" and isinstance(item, str):
                    stripped = strip_html_tags(item)
                    if stripped:
                        parts.append(stripped)
                    continue
                if structured or key in TEXT_FIELDS or key in STRUCTURE_FIELDS:
                    collect(item, structured=structured or key in STRUCTURE_FIELDS or key == "content")

    collect(resource)
    return "\n".join(parts)[:50000]


def _must_cover_terms(task: dict[str, Any]) -> list[str]:
    terms: list[str] = []
    outline = task.get("outline") or {}
    for section in outline.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for term in section.get("must_cover") or []:
            cleaned = str(term).strip()
            if cleaned and cleaned not in terms:
                terms.append(cleaned)
    return terms


def is_term_covered(term: str, text: str) -> bool:
    """Accept exact keywords plus clear definition/principle phrasing."""

    parts = [part.strip() for part in re.split(r"[、，,;]+", term) if part.strip()]
    if len(parts) > 1 and all(is_term_covered(part, text) for part in parts):
        return True

    def formula(value: str) -> str:
        """Normalize presentation-only differences in common DP formulas."""

        normalized = unicodedata.normalize("NFKC", value).casefold()
        normalized = normalized.replace("\\max", "max").replace("\\mathrm", "")
        normalized = normalized.replace(":=", "=").replace("==", "=")
        normalized = normalized.replace("≤", "<=").replace("≥", ">=").replace("≠", "!=")
        normalized = normalized.replace("→", "=").replace("←", "=")
        normalized = re.sub(r"(?:weights?|weight|价值|value)\s*\[\s*i\s*\]", lambda match: "wi" if match.group(0).casefold().startswith("weight") else "vi", normalized)
        normalized = re.sub(r"(?:w|v)_?\{?i\}?", lambda match: match.group(0)[0] + "i", normalized)
        normalized = re.sub(r"[\\$`{}（）()]", "", normalized)
        return re.sub(r"\s+", "", normalized)

    formula_term = formula(term)
    formula_text = formula(text)
    if (
        formula_term
        and formula_term in formula_text
        and re.search(r"dp\[|=|max|lcs", formula_term)
    ):
        return True
    # Formula titles are often represented only by their equation in generated
    # material.  Treat those canonical equations as explicit coverage, without
    # accepting an unrelated prose mention of dynamic programming.
    has_dp_equation = bool(
        re.search(r"dp\[[^\]]+\]\[[^\]]+\]=", formula_text)
    )
    if any(marker in term for marker in ("状态转移方程", "递推关系")) and has_dp_equation:
        return True
    if "边界初始化" in term and (
        re.search(r"dp\[0\](?:\[[^\]]+\])?=", formula_text)
        or re.search(r"(?:边界|初始).*?(?:设为|为)\s*0", text)
    ):
        return True
    if "边界初始化" in term:
        return False
    if "01背包" in term or ("dp[i][w]" in formula_term and "max" in formula_term):
        if all(token in formula_text for token in ("dp[i][w]", "max", "i-1")):
            return True
    if "lcs" in term.casefold() or "最长公共子序列" in term:
        if has_dp_equation and (
            "dp[i-1][j-1]+1" in formula_text
            or ("max" in formula_text and "dp[i-1][j]" in formula_text and "dp[i][j-1]" in formula_text)
        ):
            return True

    def compact(value: str, *, strip_intent: bool = False) -> str:
        normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value.casefold())
        for source, target in (
            ("push", "入栈"),
            ("pop", "出栈"),
            ("lifo", "后进先出"),
            ("序列", "顺序"),
            ("表的一端", "表端"),
            ("表一端", "表端"),
            ("表尾", "表端"),
            ("只允许", "仅"),
            ("只能", "仅"),
            ("匹配判断", "判断匹配"),
            ("栈入栈", "入栈"),
            ("栈出栈", "出栈"),
        ):
            normalized = normalized.replace(source, target)
        for connective in ("一种", "进行", "操作", "限定", "受限", "称为", "的", "和"):
            normalized = normalized.replace(connective, "")
        if strip_intent:
            for marker in (
                "如何解决",
                "给定",
                "给出",
                "判断",
                "是否",
                "如何",
                "要求",
                "必须",
                "明确",
            ):
                normalized = normalized.replace(marker, "")
        return normalized

    def ordered_coverage(needle: str, haystack: str) -> float:
        if not needle or not haystack:
            return 0.0
        max_span = max(12, int(len(needle) * 2.5))
        best = 0.0
        start = haystack.find(needle[0])
        attempts = 0
        while start >= 0 and attempts < 80:
            position = start
            matched = 0
            for char in needle:
                found = haystack.find(char, position)
                if found < 0 or found - start > max_span:
                    continue
                matched += 1
                position = found + 1
            best = max(best, matched / len(needle))
            if best >= 0.75:
                return best
            start = haystack.find(needle[0], start + 1)
            attempts += 1
        return best

    normalized_term = compact(term, strip_intent=True)
    normalized_text = compact(text)
    ascii_tokens = [
        compact(token) for token in re.findall(r"[a-z]+", term.casefold())
    ]
    if normalized_term in normalized_text:
        return True

    state_change_suffix = "状态变化"
    if normalized_term.endswith(state_change_suffix):
        entity = normalized_term[: -len(state_change_suffix)]
        if entity and entity in normalized_text and any(
            marker in normalized_text
            for marker in ("过程", "步骤", "变为", "栈内", "栈顶", "从", "到")
        ):
            return True
    for suffix in (
        "定义",
        "概念",
        "原则",
        "性质",
        "特性",
        "特点",
        "说明",
        "验证",
        "应用",
        "分析",
        "代码",
        "问题",
    ):
        normalized_suffix = suffix.casefold()
        if not normalized_term.endswith(normalized_suffix):
            continue
        core = normalized_term[: -len(normalized_suffix)]
        if not core:
            continue
        if suffix == "代码" and ascii_tokens and all(
            token in normalized_text for token in ascii_tokens
        ):
            return True
        if suffix == "定义" and len(core) == 1:
            return re.search(rf"{re.escape(core)}.{{0,6}}(?:是|指|定义)", normalized_text) is not None
        if core in normalized_text:
            return True
        core_chars = "".join(re.findall(r"[\u4e00-\u9fff]", core))
        if len(core_chars) >= 4:
            return ordered_coverage(core_chars, normalized_text) >= 0.75
        return False

    if ascii_tokens and not all(token in normalized_text for token in ascii_tokens):
        return False

    chinese_chars = "".join(re.findall(r"[\u4e00-\u9fff]", normalized_term))
    if ascii_tokens and len(chinese_chars) <= 2:
        return True
    if len(chinese_chars) >= 4:
        return ordered_coverage(chinese_chars, normalized_text) >= 0.75
    return False


_COUNT_TOKEN = r"\d+|[一二两三四五六七八九十]{1,3}"
_CHINESE_COUNTS = {
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _parse_count_token(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    if token in _CHINESE_COUNTS:
        return _CHINESE_COUNTS[token]
    if "十" not in token or token.count("十") != 1:
        return None
    left, right = token.split("十")
    tens = 1 if not left else _CHINESE_COUNTS.get(left)
    ones = 0 if not right else _CHINESE_COUNTS.get(right)
    if tens is None or ones is None:
        return None
    return tens * 10 + ones


def _expected_count(criteria: list[Any], unit: str) -> int | None:
    for criterion in criteria:
        pattern = (
            rf"(?<![0-9一二两三四五六七八九十百千万])({_COUNT_TOKEN})"
            rf"(?![0-9一二两三四五六七八九十百千万])"
            rf"\s*(?:道)?(?:[^，。；,;\n]{{0,6}})?题"
            if unit == "道题"
            else rf"(?<![0-9一二两三四五六七八九十百千万])({_COUNT_TOKEN})"
            rf"(?![0-9一二两三四五六七八九十百千万])\s*{re.escape(unit)}"
        )
        match = re.search(pattern, str(criterion))
        if match:
            parsed = _parse_count_token(match.group(1))
            if parsed is not None:
                return parsed
    return None


def _criterion_count(value: str, object_pattern: str) -> int | None:
    match = re.search(
        rf"(?<![0-9一二两三四五六七八九十百千万])({_COUNT_TOKEN})"
        rf"(?![0-9一二两三四五六七八九十百千万])"
        rf"\s*(?:个|项|则|种|道)?\s*"
        rf"(?:[\u4e00-\u9fff]\s*){{0,10}}?(?:{object_pattern})",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return _parse_count_token(match.group(1))


def _distinct_example_count(resource: dict[str, Any], text: str) -> int:
    candidates: set[str] = set()

    def remember(value: Any) -> None:
        if isinstance(value, str):
            normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value.casefold())
            if len(normalized) >= 4:
                candidates.add(normalized[:160])
        elif isinstance(value, list):
            for item in value:
                remember(item)
        elif isinstance(value, dict):
            for key in ("title", "description", "content", "example", "text"):
                if key in value:
                    remember(value[key])

    for key in ("examples", "scenarios", "cases", "variations"):
        remember(resource.get(key))

    for match in re.finditer(
        r"(?:示例|例子|案例|场景|例如|比如)\s*(?:[一二两三四五六七八九十\d]+)?"
        r"\s*[:：、.]?\s*([^。！？\n]{4,160})",
        text,
        flags=re.IGNORECASE,
    ):
        remember(match.group(1))
    return len(candidates)


def _nested_item_count(value: Any) -> int:
    if not isinstance(value, list):
        return 0
    total = 0
    for item in value:
        total += 1
        if isinstance(item, dict):
            total += _nested_item_count(item.get("children"))
    return total


def _quality_criterion_issues(
    resource_type: str,
    criterion: Any,
    resource: dict[str, Any],
    text: str,
) -> list[str]:
    """Turn supported plan criteria into deterministic, fail-closed checks.

    Broad accuracy/clarity wording is covered by the outline coverage and
    resource-type gates in ``review_resource``. Criteria outside the supported
    vocabulary are rejected instead of being displayed to the user as if they
    had been verified.
    """

    value = str(criterion).strip()
    if not value:
        return ["验收标准为空，无法自动验证"]

    normalized = text.casefold()
    handled = False
    numeric_handled = False
    issues: list[str] = []

    question_count = _criterion_count(value, r"(?:练习)?题|题目")
    if question_count is not None:
        handled = True
        numeric_handled = True
        actual_questions = len(resource.get("questions") or [])
        if resource_type not in QUESTION_RESOURCE_TYPES:
            textual_questions = max(
                len(re.findall(r"[?？]", text)),
                len(re.findall(r"(?:思考题|练习题|问题|题目)\s*[一二两三四五六七八九十\d]*\s*[:：]", text)),
            )
            actual_questions = max(actual_questions, textual_questions)
        if resource_type not in QUESTION_RESOURCE_TYPES and actual_questions < question_count:
            issues.append(
                f"验收标准“{value}”要求 {question_count} 道题，"
                f"实际只有 {actual_questions} 道"
            )

    example_count = _criterion_count(value, r"示例|例子|案例|场景")
    if example_count is not None:
        handled = True
        numeric_handled = True
        actual = _distinct_example_count(resource, text)
        if actual < example_count:
            issues.append(
                f"验收标准“{value}”要求至少 {example_count} 个不同示例，实际识别到 {actual} 个"
            )

    page_count = _criterion_count(value, r"页|幻灯片")
    if page_count is not None:
        handled = True
        numeric_handled = True
        actual = len(resource.get("slides") or [])
        if actual < page_count:
            issues.append(f"验收标准“{value}”要求至少 {page_count} 页，实际只有 {actual} 页")

    second_count = _criterion_count(value, r"秒")
    minute_count = _criterion_count(value, r"分钟")
    if second_count is not None or minute_count is not None:
        handled = True
        numeric_handled = True
        expected_seconds = float(second_count or (minute_count or 0) * 60)
        actual_seconds = 0.0
        for segment in resource.get("narration") or resource.get("scenes") or []:
            if isinstance(segment, dict):
                try:
                    actual_seconds += float(segment.get("duration") or 0)
                except (TypeError, ValueError):
                    pass
        if actual_seconds < expected_seconds * 0.8:
            issues.append(
                f"验收标准“{value}”要求约 {expected_seconds:g} 秒，"
                f"实际只有 {actual_seconds:g} 秒"
            )

    word_count = _criterion_count(value, r"字|字符")
    if word_count is not None:
        handled = True
        numeric_handled = True
        if len(text) < word_count:
            issues.append(f"验收标准“{value}”要求至少 {word_count} 字，实际只有 {len(text)} 字")

    point_count = _criterion_count(value, r"知识点|要点")
    if point_count is not None:
        handled = True
        numeric_handled = True
        actual = len(resource.get("key_points") or [])
        if actual < point_count:
            issues.append(f"验收标准“{value}”要求至少 {point_count} 个要点，实际只有 {actual} 个")

    node_count = _criterion_count(value, r"节点")
    if node_count is not None:
        handled = True
        numeric_handled = True
        actual = _nested_item_count(resource.get("nodes"))
        if actual < node_count:
            issues.append(f"验收标准“{value}”要求至少 {node_count} 个节点，实际只有 {actual} 个")

    segment_count = _criterion_count(value, r"段(?:落|旁白|分镜)?")
    if segment_count is not None:
        handled = True
        numeric_handled = True
        structured_segments = resource.get("narration") or resource.get("scenes") or []
        actual = (
            len(structured_segments)
            if isinstance(structured_segments, list) and structured_segments
            else len([part for part in re.split(r"\n\s*\n", text) if part.strip()])
        )
        if actual < segment_count:
            issues.append(f"验收标准“{value}”要求至少 {segment_count} 段，实际只有 {actual} 段")

    section_count = _criterion_count(value, r"章节|小节")
    if section_count is not None:
        handled = True
        numeric_handled = True
        actual = len(re.findall(r"(?m)^\s*#{1,6}\s+\S", text))
        if actual < section_count:
            issues.append(f"验收标准“{value}”要求至少 {section_count} 个章节，实际只有 {actual} 个")

    if "复杂度" in value:
        handled = True
        complexity_hits = re.findall(
            r"时间复杂度|空间复杂度|复杂度(?:为|是)?|big\s*o|o\s*\([^)]{1,16}\)",
            normalized,
            flags=re.IGNORECASE,
        )
        if not complexity_hits:
            issues.append(f"验收标准“{value}”要求复杂度说明，但资料没有复杂度证据")
        elif any(marker in value for marker in ("对比", "比较")) and not (
            len(complexity_hits) >= 2
            or re.search(r"对比|比较|相比|区别|分别|两者|而", normalized)
        ):
            issues.append(f"验收标准“{value}”要求复杂度对比，但资料只给出了单项结论")

    if any(marker in value for marker in ("对比", "比较")):
        handled = True
        if not re.search(r"对比|比较|相比|区别|不同|分别|两者|而", normalized):
            issues.append(f"验收标准“{value}”要求比较，但资料没有明确的比较关系")

    if "选型" in value:
        handled = True
        if not re.search(r"选型|选择|适合|适用|场景|建议", normalized):
            issues.append(f"验收标准“{value}”要求选型结论，但资料没有适用场景或选择建议")

    if any(marker in value for marker in ("示例", "例子", "场景")):
        handled = True
        if not re.search(
            r"示例|例如|比如|例子|场景|应用|def\s+\w+|function\s+\w+",
            text,
            flags=re.IGNORECASE,
        ):
            issues.append(f"验收标准“{value}”要求示例或场景，但资料没有可识别的示例")

    if any(marker in value for marker in ("异常", "边界")):
        handled = True
        code = str(resource.get("code") or "")
        if not re.search(
            r"异常|边界|空(?:列表|栈|集合|输入)|越界|错误|try\b|except\b|raise\b|"
            r"(?:index|value|type|key)error|if\s+not\b|len\s*\([^)]*\)\s*==\s*0",
            f"{text}\n{code}",
            flags=re.IGNORECASE,
        ):
            issues.append(f"验收标准“{value}”要求覆盖异常边界，但资料没有边界处理证据")

    if any(marker in value for marker in ("输入", "输出")):
        handled = True
        if not re.search(r"输入|输出|input\s*\(|print\s*\(|return\b", normalized):
            issues.append(f"验收标准“{value}”要求输入输出说明，但资料没有对应证据")

    # These criteria are checked by the existing structural/type gates below.
    structural_markers = (
        "代码",
        "可运行",
        "可执行",
        "语法",
        "答案",
        "解析",
        "题干",
        "选项",
        "唯一",
        "题目",
        "练习题",
        "判断",
        "层次",
        "层级",
        "节点",
        "课件",
        "幻灯片",
        "旁白",
        "时长",
        "分镜",
        "阅读",
        "讨论题",
        "来源",
        "引用",
        "类比",
    )
    if any(marker in value for marker in structural_markers):
        handled = True

    # Accuracy and completeness are operationalized by must_cover coverage,
    # minimum content density and the type-specific structural checks.
    content_markers = (
        "定义",
        "原则",
        "操作",
        "顺序",
        "知识点",
        "大纲",
        "覆盖",
        "准确",
        "清晰",
        "完整",
        "通俗",
        "易懂",
        "初学者",
        "目标",
        "应用",
        "说明",
        "解释",
        "关系",
        "结构",
        "概念",
        "难度",
        "核心",
    )
    if any(marker in value for marker in content_markers):
        handled = True

    if resource_type in QUESTION_RESOURCE_TYPES and any(
        marker in value
        for marker in ("push", "pop", "lifo", "括号", "状态", "匹配", "题")
    ):
        handled = True

    numeric_claim = re.search(
        r"(?:\d+|[一二两三四五六七八九十百千万]+)\s*"
        r"(?:个|项|则|种|道|页|秒|分钟|字|题|段)",
        value,
    )
    if numeric_claim and not numeric_handled:
        handled = True
        issues.append(f"无法自动验证的数量验收标准：{value}")

    if not handled:
        issues.append(f"无法自动验证的验收标准：{value}")
    return issues


def _criterion_issue_is_blocking(criterion: Any, issue: str) -> bool:
    """Keep only high-confidence, deliverable gaps on the blocking path."""

    value = str(criterion)
    if "示例" in value or "例子" in value or "案例" in value or "场景" in value:
        return False
    if issue.startswith("无法自动验证"):
        return False
    # Explicit count shortfalls are objective except for example counting,
    # which depends on a deliberately conservative heuristic above.
    return bool(re.search(r"(?:实际只有|实际识别到|实际为|至少).*(?:道|页|秒|字|要点|节点|段|章节)", issue))


def review_blocking_issues(review: dict[str, Any]) -> list[str]:
    """Read severity-aware reviews while treating old persisted issues as blocking."""

    explicit = [str(item) for item in review.get("blocking_issues") or [] if str(item)]
    if explicit:
        return explicit
    warnings = [str(item) for item in review.get("warnings") or [] if str(item)]
    issues = [str(item) for item in review.get("issues") or [] if str(item)]
    return issues if issues and not warnings else []


def _must_cover_locations(task: dict[str, Any]) -> dict[str, str]:
    locations: dict[str, str] = {}
    for index, section in enumerate((task.get("outline") or {}).get("sections") or [], 1):
        if not isinstance(section, dict):
            continue
        title = str(section.get("title") or f"第 {index} 节").strip()
        for term in section.get("must_cover") or []:
            cleaned = str(term).strip()
            if cleaned and cleaned not in locations:
                locations[cleaned] = title
    return locations


def _issue_fingerprint(issue: str, required_terms: list[str] | None = None) -> str:
    normalized = re.sub(r"[\s，、,;；:：]+", "", unicodedata.normalize("NFKC", str(issue)).casefold())
    terms = "|".join(
        sorted(
            re.sub(r"[\s，、,;；:：]+", "", unicodedata.normalize("NFKC", str(term)).casefold())
            for term in required_terms or []
        )
    )
    return sha256(f"{normalized}|{terms}".encode("utf-8")).hexdigest()[:16]


def _looks_like_code_expression(term: str) -> bool:
    return bool(re.search(r"dp\[|(?:=|:=|<=|>=|max\s*\()|[+*/]", term.casefold()))


def _repair_target(
    resource_type: str,
    issue: str,
    section_title: str | None,
    required_term: str = "",
) -> tuple[str, str]:
    section_location = f"大纲章节「{section_title}」" if section_title else "资料正文与大纲对应位置"
    if resource_type in {"explainer", "reading"}:
        return ("explanation" if resource_type == "explainer" else "content", section_location)
    if resource_type == "code":
        if "语法错误" in issue or "代码正文" in issue:
            return "code", "代码主体"
        if (
            _looks_like_code_expression(required_term)
            or "公式" in issue
            or "状态转移" in issue
            or "递推" in issue
        ):
            return "code（注释）或 explanation", section_location
        return "code 或 explanation", section_location
    if resource_type in QUESTION_RESOURCE_TYPES:
        match = re.search(r"第\s*(\d+)\s*题", issue)
        question_location = f"questions[{int(match.group(1)) - 1}]" if match else "questions[]"
        if "题干" in issue:
            return "questions[].stem", question_location
        if "选项" in issue:
            return "questions[].options", question_location
        if "答案" in issue:
            return "questions[].answer", question_location
        if "解析" in issue or section_title:
            return "questions[].explanation", question_location
        return "questions", "测验题目结构"
    if resource_type == "mindmap":
        return "nodes", "思维导图节点树"
    if resource_type == "courseware":
        return "slides", "课件幻灯片结构"
    if resource_type == "video":
        return "scenes/narration", "视频分镜与旁白"
    if resource_type == "interactive":
        for field in ("html", "css", "js", "runtime", "interactions", "summary"):
            if field in issue:
                return field, "交互演示 payload"
        return "html", "交互演示 payload"
    return "content", section_location


def _positive_repair_evidence(resource_type: str, issue: str, target_field: str) -> list[str]:
    """Describe proof of repair, never repeat the failed condition as evidence."""

    if resource_type == "code":
        if "语法错误" in issue:
            return ["code 可被目标语言编译，且不抛出 SyntaxError"]
        if "代码正文" in issue:
            return ["code 字段包含完整可运行代码"]
        return ["code 或 explanation 包含可执行实现与必要说明"]
    if resource_type in QUESTION_RESOURCE_TYPES:
        if "没有生成任何题目" in issue:
            return ["questions 为非空数组，包含至少 1 道有效题目"]
        count = re.search(r"题目数量应为\s*(\d+)\s*道", issue)
        if count:
            return [f"questions 数量精确为 {count.group(1)} 道"]
        if "题干" in issue:
            return ["questions[].stem 非空"]
        if "选项" in issue:
            return ["questions[].options 至少包含 2 个选项"]
        if "答案" in issue:
            return ["questions[].answer 非空"]
        if "解析" in issue:
            return ["questions[].explanation 非空且包含解析"]
        return ["questions[] 字段完整且符合题型结构"]
    if resource_type == "mindmap":
        if "一级分支" in issue:
            return ["nodes 至少包含 3 个一级分支"]
        if "二级节点" in issue:
            return ["nodes 包含至少一层 children 二级节点"]
        if "重复节点标签" in issue:
            return ["nodes 中每个 label 唯一"]
        return ["nodes 形成可审核的层级节点树"]
    if resource_type == "courseware":
        if "至少需要" in issue or "页" in issue:
            return ["slides 至少包含 8 页"]
        return ["每个 slides[] 项均有非空 title 和 content"]
    if resource_type == "video":
        if "连续段落" in issue:
            return ["scenes/narration 至少包含 2 个连续段落"]
        if "空段落" in issue:
            return ["每个 scenes/narration 段落均有非空 text 或 narration"]
        if "时长格式" in issue:
            return ["每个 scenes/narration.duration 为可解析数值"]
        return ["scenes/narration 总时长在 150 到 300 秒之间"]
    if resource_type == "interactive":
        return [f"{target_field} 通过沙箱安全校验：无外链、无 <script>、无内联事件，且在无网络环境下可运行"]
    if resource_type in {"explainer", "reading"} and "正文过短" in issue:
        minimum = re.search(r"至少需要\s*(\d+)\s*个字符", issue)
        count = minimum.group(1) if minimum else ("100" if resource_type == "explainer" else "300")
        field = "explanation" if resource_type == "explainer" else "content"
        return [f"{field} 正文至少达到 {count} 个字符"]
    return [f"{target_field} 满足对应审核规则"]


def _repair_instructions(
    *,
    resource_type: str,
    blocking_issues: list[str],
    missing_terms: list[str],
    term_locations: dict[str, str],
) -> list[RepairInstruction]:
    instructions: list[RepairInstruction] = []
    missing_issue_prefix = "大纲必须覆盖点缺失："
    for issue in blocking_issues:
        if issue.startswith(missing_issue_prefix):
            for term in missing_terms:
                section_title = term_locations.get(term)
                target_field, location = _repair_target(
                    resource_type,
                    issue,
                    section_title,
                    term,
                )
                evidence = [term]
                if resource_type == "code" and _looks_like_code_expression(term):
                    evidence.append(f"完整表达式：{term}")
                    evidence.append("code 注释或 explanation 包含上述完整表达式")
                    action = (
                        f"在 code 注释或 explanation 中完整写出表达式「{term}」，"
                        "并保留其他已通过章节。"
                    )
                else:
                    action = f"在 {target_field} 中显式补写「{term}」，保留其他已通过章节。"
                instructions.append(
                    RepairInstruction(
                        issue=f"大纲必须覆盖点缺失：{term}",
                        location=location,
                        target_field=target_field,
                        action=action,
                        acceptance_check=(
                            f"现有审核器能在生成资源真实正文或结构中识别「{term}」，"
                            "且不依赖计划元数据。"
                        ),
                        required_terms=[term],
                        required_evidence=evidence,
                        fingerprint=_issue_fingerprint("must-cover", [term]),
                    )
                )
            continue
        target_field, location = _repair_target(resource_type, issue, None)
        instructions.append(
            RepairInstruction(
                issue=issue,
                location=location,
                target_field=target_field,
                action=f"仅修订 {target_field}：{issue}。保留已通过的来源、示例和结构。",
                acceptance_check=f"重新审核时，{target_field} 满足：{issue} 不再出现。",
                required_evidence=_positive_repair_evidence(resource_type, issue, target_field),
                fingerprint=_issue_fingerprint(issue),
            )
        )
    return instructions


def review_resource(resource: dict[str, Any], task: dict[str, Any]) -> TaskReview:
    """Apply outline coverage plus type-specific blocking checks."""

    blocking_issues: list[str] = []
    warnings: list[str] = []
    score = 1.0

    def reject(message: str, deduction: float = 0.35) -> None:
        nonlocal score
        if message not in blocking_issues:
            blocking_issues.append(message)
            score -= deduction

    def warn(message: str) -> None:
        if message not in warnings:
            warnings.append(message)

    text = extract_resource_text(resource)
    normalized = text.casefold()
    resource_type = str(resource.get("type") or task.get("type") or "")
    quiz_questions = resource.get("questions") or []

    def quiz_structure_covers(term: str) -> bool:
        if resource_type not in QUESTION_RESOURCE_TYPES or not isinstance(quiz_questions, list) or not quiz_questions:
            return False
        if "答案" in term:
            return all(
                isinstance(question, dict)
                and bool(str(question.get("answer") or "").strip())
                for question in quiz_questions
            )
        if "解析" in term:
            return all(
                isinstance(question, dict)
                and len(str(question.get("explanation") or "").strip()) >= 20
                for question in quiz_questions
            )
        return False

    must_cover = _must_cover_terms(task)
    term_locations = _must_cover_locations(task)
    missing = [
        term
        for term in must_cover
        if not quiz_structure_covers(term) and not is_term_covered(term, normalized)
    ]
    if missing:
        reject(
            f"大纲必须覆盖点缺失：{'、'.join(missing)}",
            min(0.6, 0.5 * len(missing) / max(1, len(must_cover))),
        )

    criteria = list(task.get("quality_criteria") or [])

    if resource_type in QUESTION_RESOURCE_TYPES:
        questions = resource.get("questions") or []
        expected = _expected_count(criteria, "道题")
        if not isinstance(questions, list) or not questions:
            reject("测验没有生成任何题目", 0.6)
        else:
            if expected is not None and len(questions) != expected:
                reject(f"题目数量应为 {expected} 道，实际为 {len(questions)} 道")
            for index, question in enumerate(questions, 1):
                if not isinstance(question, dict) or not str(question.get("stem") or "").strip():
                    reject(f"第 {index} 题缺少题干")
                    continue
                if not str(question.get("answer") or "").strip():
                    reject(f"第 {index} 题缺少答案")
                if not str(question.get("explanation") or "").strip():
                    reject(f"第 {index} 题缺少解析")
                if question.get("type") in {"mcq", "judge"} and len(question.get("options") or []) < 2:
                    reject(f"第 {index} 题选项不足")

    elif resource_type == "code":
        code = str(resource.get("code") or "")
        if not code.strip():
            reject("代码资料没有代码正文", 0.6)
        elif str(resource.get("language") or "python").lower() in {"python", "py"}:
            try:
                compile(code, "<resource>", "exec")
            except SyntaxError as exc:
                reject(f"Python 代码存在语法错误：第 {exc.lineno or 0} 行", 0.6)

    elif resource_type == "mindmap":
        nodes = resource.get("nodes") or []
        if not isinstance(nodes, list) or len(nodes) < 3:
            reject("思维导图至少需要 3 个一级分支")
        labels: list[str] = []

        def walk(items: Any, depth: int = 1) -> int:
            deepest = depth
            if not isinstance(items, list):
                return deepest
            for item in items:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()
                if label:
                    labels.append(label)
                children = item.get("children") or []
                if children:
                    deepest = max(deepest, walk(children, depth + 1))
            return deepest

        depth = walk(nodes)
        if depth < 2:
            reject("思维导图缺少二级节点，层级过浅")
        if len(labels) != len(set(labels)):
            reject("思维导图存在重复节点标签")

    elif resource_type == "courseware":
        slides = resource.get("slides") or []
        if not isinstance(slides, list) or len(slides) < 8:
            reject("课件至少需要 8 页有效幻灯片", 0.5)
        if isinstance(slides, list) and any(
            not isinstance(slide, dict)
            or not str(slide.get("title") or "").strip()
            or not (slide.get("content") or [])
            for slide in slides
        ):
            reject("课件存在缺少标题或内容的页面")

    elif resource_type == "interactive":
        payload = resource.get("data")
        if not isinstance(payload, dict):
            payload = resource
        for issue in validate_interactive_payload(payload):
            reject(issue, 0.4)

    elif resource_type == "video":
        narration = resource.get("narration") or resource.get("scenes") or []
        if not isinstance(narration, list) or len(narration) < 2:
            reject("视频旁白至少需要 2 个连续段落", 0.5)
        total_duration = 0.0
        if isinstance(narration, list):
            for segment in narration:
                if not isinstance(segment, dict) or not str(
                    segment.get("text") or segment.get("narration") or ""
                ).strip():
                    reject("视频旁白存在空段落")
                try:
                    total_duration += float(segment.get("duration") or 0)
                except (TypeError, ValueError):
                    reject("视频旁白时长格式无效")
        if total_duration < 150 or total_duration > 300:
            reject(
                f"视频旁白总时长不合理：{total_duration:g} 秒；"
                "教学讲解应保持在 150-300 秒"
            )

    elif resource_type in {"explainer", "reading"}:
        minimum = 100 if resource_type == "explainer" else 300
        if len(text) < minimum:
            label = "讲义" if resource_type == "explainer" else "阅读材料"
            reject(f"{label}正文过短，至少需要 {minimum} 个字符", 0.5)
        criteria_text = "；".join(str(item) for item in criteria)
        if "类比" in criteria_text and not re.search(
            r"类比|例如|比如|好比|就像|想象|叠盘|浏览器后退",
            text,
        ):
            warn("验收标准要求类比，但正文没有可识别的类比或生活场景")
        if any(marker in criteria_text for marker in ("来源", "引用")) and not (
            resource.get("sources")
            or re.search(r"\[来源\s*\d*\]|来源[:：]|引用", text)
        ):
            warn("验收标准要求来源引用，但正文没有来源标记")

    for criterion in criteria:
        for issue in _quality_criterion_issues(resource_type, criterion, resource, text):
            if _criterion_issue_is_blocking(criterion, issue):
                reject(issue)
            else:
                warn(issue)

    score = round(max(0.0, min(1.0, score)), 3)
    issues = [*blocking_issues, *warnings]
    repair_instructions = _repair_instructions(
        resource_type=resource_type,
        blocking_issues=blocking_issues,
        missing_terms=missing,
        term_locations=term_locations,
    )
    fixes = [instruction.action for instruction in repair_instructions]
    return TaskReview(
        approved=score >= 0.75 and not blocking_issues,
        score=score,
        issues=issues,
        blocking_issues=blocking_issues,
        blocking_fingerprints=[instruction.fingerprint for instruction in repair_instructions],
        warnings=warnings,
        fixes=fixes,
        repair_instructions=repair_instructions,
    )
