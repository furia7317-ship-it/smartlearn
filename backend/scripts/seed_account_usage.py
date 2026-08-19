#!/usr/bin/env python3
"""Seed or remove a coherent, explicitly tagged usage history for one local account."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SEED_TAG = "codex_usage_v1"
ID_PREFIX = f"seed_{SEED_TAG}"
DEFAULT_DB = Path(__file__).resolve().parents[1] / "smartlearn.db"


def encoded(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sql_time(value: datetime) -> str:
    return value.replace(tzinfo=None, microsecond=0).isoformat(sep=" ")


def iso_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def remove_seed(connection: sqlite3.Connection, student_id: str) -> dict[str, int]:
    removed: dict[str, int] = {}

    event_ids = []
    for row in connection.execute(
        "select id, payload from behavior_events where student_id=?",
        (student_id,),
    ):
        try:
            payload = json.loads(row[1]) if isinstance(row[1], str) else row[1]
        except (TypeError, json.JSONDecodeError):
            payload = {}
        if isinstance(payload, dict) and payload.get("seed_tag") == SEED_TAG:
            event_ids.append(int(row[0]))
    if event_ids:
        placeholders = ",".join("?" for _ in event_ids)
        removed["behavior_events"] = connection.execute(
            f"delete from behavior_events where id in ({placeholders})",
            event_ids,
        ).rowcount
    else:
        removed["behavior_events"] = 0

    deletions = (
        ("review_logs", "student_id=? and card_id like ?", (student_id, f"{ID_PREFIX}%")),
        ("memory_cards", "student_id=? and id like ?", (student_id, f"{ID_PREFIX}%")),
        ("wrong_questions", "student_id=? and exam_id like ?", (student_id, f"{ID_PREFIX}%")),
        ("exam_papers", "student_id=? and (id like ? or exam_id like ?)", (student_id, f"{ID_PREFIX}%", f"{ID_PREFIX}%")),
        ("generated_materials", "student_id=? and id like ?", (student_id, f"{ID_PREFIX}%")),
        ("assessments", "student_id=? and id like ?", (student_id, f"{ID_PREFIX}%")),
        ("learning_goals", "student_id=? and source=?", (student_id, SEED_TAG)),
        ("learning_paths", "student_id=? and id like ?", (student_id, f"{ID_PREFIX}%")),
        ("conversation_sessions", "student_id=? and id like ?", (student_id, f"{ID_PREFIX}%")),
    )
    for table, where, params in deletions:
        removed[table] = connection.execute(
            f"delete from {table} where {where}",
            params,
        ).rowcount

    workspace = connection.execute(
        "select state from learner_workspace_states where student_id=?",
        (student_id,),
    ).fetchone()
    if workspace:
        try:
            state = json.loads(workspace[0]) if isinstance(workspace[0], str) else workspace[0]
        except (TypeError, json.JSONDecodeError):
            state = {}
        if isinstance(state, dict) and state.get("seed_tag") == SEED_TAG:
            removed["learner_workspace_states"] = connection.execute(
                "delete from learner_workspace_states where student_id=?",
                (student_id,),
            ).rowcount
        else:
            removed["learner_workspace_states"] = 0
    else:
        removed["learner_workspace_states"] = 0
    return removed


def material_rows(student_id: str, now: datetime) -> list[tuple[Any, ...]]:
    items = [
        (
            "arrays",
            "explainer",
            "数组、链表与复杂度图解",
            "从内存布局到常见操作复杂度的阶段讲义",
            ["数据结构", "图示讲义", "已学习"],
            3,
            "数组、链表、时间复杂度",
            {
                "overview": "用连续与离散内存布局对比数组和链表，解释访问、插入与删除的成本。",
                "explanation": "数组以连续地址换取 O(1) 随机访问；链表以指针连接节点，擅长已知位置附近的结构调整。",
                "analogy": "数组像有编号的固定座位，链表像按线索串联的卡片。",
                "key_points": ["随机访问与顺序访问", "头尾插入", "均摊复杂度"],
            },
            22,
        ),
        (
            "stack_tree_map",
            "mindmap",
            "栈、队列与树的知识导图",
            "把线性结构与树形结构放在一张图里比较",
            ["数据结构", "思维导图", "复盘"],
            2,
            "栈、队列、二叉树",
            {
                "nodes": [
                    {"id": "root", "label": "数据结构", "children": [
                        {"id": "linear", "label": "线性结构", "children": [
                            {"id": "stack", "label": "栈：后进先出"},
                            {"id": "queue", "label": "队列：先进先出"},
                        ]},
                        {"id": "tree", "label": "树形结构", "children": [
                            {"id": "traversal", "label": "前中后序遍历"},
                            {"id": "bst", "label": "二叉搜索树"},
                        ]},
                    ]},
                ],
            },
            18,
        ),
        (
            "practice",
            "quiz",
            "数据结构阶段练习",
            "覆盖复杂度、栈队列、二叉树与哈希冲突",
            ["数据结构", "阶段测验", "12 题"],
            1,
            "复杂度、栈、队列、树、哈希",
            {
                "questions": [
                    {"id": "q1", "type": "mcq", "stem": "数组随机访问的平均时间复杂度是？", "options": ["A. O(1)", "B. O(log n)", "C. O(n)", "D. O(n²)"], "answer": "A", "explanation": "下标可直接换算为内存地址。"},
                    {"id": "q2", "type": "mcq", "stem": "函数调用栈最符合哪一种访问规则？", "options": ["A. FIFO", "B. LIFO", "C. 随机访问", "D. 优先级访问"], "answer": "B", "explanation": "最后进入的函数最先返回。"},
                    {"id": "q3", "type": "mcq", "stem": "二叉搜索树中序遍历的结果通常是？", "options": ["A. 降序", "B. 随机", "C. 升序", "D. 层序"], "answer": "C", "explanation": "左子树、根、右子树形成有序序列。"},
                    {"id": "q4", "type": "mcq", "stem": "开放寻址法解决的主要问题是？", "options": ["A. 哈希冲突", "B. 栈溢出", "C. 指针丢失", "D. 排序稳定性"], "answer": "A", "explanation": "冲突后在表内继续探测其他位置。"},
                    {"id": "q5", "type": "mcq", "stem": "BFS 通常借助哪种结构？", "options": ["A. 栈", "B. 队列", "C. 堆", "D. 哈希表"], "answer": "B", "explanation": "按层扩展需要先进先出的队列。"},
                ],
            },
            25,
        ),
        (
            "sorting_code",
            "code",
            "归并排序：从递归到实现",
            "带复杂度分析和边界测试的 Python 示例",
            ["算法", "Python", "代码练习"],
            2,
            "归并排序、递归、分治",
            {
                "language": "python",
                "code": "def merge_sort(values):\n    if len(values) <= 1:\n        return values\n    mid = len(values) // 2\n    left = merge_sort(values[:mid])\n    right = merge_sort(values[mid:])\n    result = []\n    while left and right:\n        result.append(left.pop(0) if left[0] <= right[0] else right.pop(0))\n    return result + left + right",
                "output": "[1, 2, 3, 5, 8]",
                "variations": [{"description": "把合并阶段改为索引扫描，避免 pop(0) 的移动成本。", "code": "# 使用 i、j 双指针合并两个有序列表"}],
            },
            14,
        ),
        (
            "review_note",
            "reading",
            "错题复盘：树遍历与哈希冲突",
            "根据近期练习整理的复盘笔记",
            ["错题复盘", "树", "哈希"],
            0,
            "二叉树遍历、哈希冲突",
            {
                "content": "## 本周复盘\n\n1. 先写出遍历顺序，再判断访问结果。\n2. 哈希冲突要区分链地址法与开放寻址法。\n3. 做题后用一个最小反例检查边界。",
                "key_terms": [
                    {"term": "中序遍历", "definition": "左子树 → 根 → 右子树"},
                    {"term": "开放寻址", "definition": "冲突时按探测序列寻找空槽"},
                ],
                "discussion_questions": ["为什么退化二叉搜索树的查找会变成 O(n)？"],
            },
            12,
        ),
    ]
    rows = []
    for index, (suffix, kind, title, subtitle, meta, sources, points, data, age_days) in enumerate(items):
        payload = {**data, "reviewed": True, "review_approved": True, "seed_tag": SEED_TAG}
        exam_id = f"{ID_PREFIX}_exam_latest" if kind == "quiz" else None
        rows.append((
            f"{ID_PREFIX}_material_{suffix}", student_id, kind, title, subtitle,
            encoded(meta), sources, points, encoded(payload), "studio", exam_id,
            sql_time(now - timedelta(days=age_days, hours=index)),
        ))
    return rows


def paper_payloads() -> list[dict[str, Any]]:
    return [
        {
            "suffix": "baseline",
            "title": "数据结构基础摸底卷",
            "score": 72,
            "age": 20,
            "questions": [
                ("b1", "顺序表查找第 i 个元素的复杂度是？", "O(1)", "O(n)", "数组与链表"),
                ("b2", "链表头插操作需要移动已有元素吗？", "不需要", "需要", "数组与链表"),
                ("b3", "栈顶元素出栈后哪个指针发生变化？", "top", "rear", "栈"),
                ("b4", "BFS 需要使用哪种辅助结构？", "队列", "栈", "队列"),
                ("b5", "中序遍历顺序是什么？", "左-根-右", "根-左-右", "二叉树"),
            ],
            "correct": {"b1", "b2", "b3"},
        },
        {
            "suffix": "midterm",
            "title": "栈、队列与树阶段测验",
            "score": 84,
            "age": 9,
            "questions": [
                ("m1", "递归调用最直接依赖的数据结构是？", "栈", "队列", "栈"),
                ("m2", "循环队列判满时常预留几个位置？", "1", "0", "队列"),
                ("m3", "满二叉树第 k 层最多有多少节点？", "2^(k-1)", "2k", "二叉树"),
                ("m4", "BST 中序遍历是否有序？", "是", "否", "二叉搜索树"),
                ("m5", "退化 BST 的最坏查找复杂度是？", "O(n)", "O(log n)", "二叉搜索树"),
            ],
            "correct": {"m1", "m2", "m3", "m4"},
        },
        {
            "suffix": "latest",
            "title": "排序与哈希综合练习",
            "score": 88,
            "age": 1,
            "questions": [
                ("l1", "归并排序的平均时间复杂度是？", "O(n log n)", "O(n²)", "归并排序"),
                ("l2", "快速排序最坏时间复杂度是？", "O(n²)", "O(log n)", "快速排序"),
                ("l3", "链地址法如何处理冲突？", "同槽元素用链表连接", "覆盖旧值", "哈希冲突"),
                ("l4", "负载因子过高通常会怎样？", "冲突增加", "冲突减少", "哈希表"),
                ("l5", "稳定排序会保留什么？", "相等元素的原相对顺序", "所有元素原位置", "排序稳定性"),
            ],
            "correct": {"l1", "l2", "l3", "l5"},
        },
    ]


def build_path(material_ids: dict[str, str]) -> list[dict[str, Any]]:
    stages = [
        ("复杂度与线性表", "建立复杂度直觉并比较数组、链表", "arrays"),
        ("栈与队列", "掌握 LIFO、FIFO 及典型应用", "stack_tree_map"),
        ("树与二叉树", "理解遍历顺序与树的结构性质", "stack_tree_map"),
        ("二叉搜索树", "分析查找、插入和退化情形", "practice"),
        ("哈希表", "比较链地址法与开放寻址法", "review_note"),
        ("基础排序", "区分稳定性、时间和空间复杂度", "sorting_code"),
        ("归并与快速排序", "通过代码建立分治算法直觉", "sorting_code"),
        ("综合复盘", "完成阶段测验并整理错题", "practice"),
    ]
    path = []
    task_index = 0
    for day_index, (title, objective, resource_key) in enumerate(stages, 1):
        lecture_key = f"{ID_PREFIX}_task_{task_index + 1:02d}"
        practice_key = f"{ID_PREFIX}_task_{task_index + 2:02d}"
        resource_id = material_ids[resource_key]
        resource_type = "quiz" if resource_key == "practice" else (
            "code" if resource_key == "sorting_code" else
            "mindmap" if resource_key == "stack_tree_map" else
            "reading" if resource_key == "review_note" else "explainer"
        )
        path.append({
            "day": f"D{day_index}",
            "title": title,
            "desc": objective,
            "objective": objective,
            "minutes": 50,
            "types": [resource_type, "quiz"],
            "state": "current" if day_index == 1 else "todo",
            "steps": [
                {
                    "title": f"学习：{title}",
                    "detail": objective,
                    "minutes": 30,
                    "resource_types": [resource_type],
                    "completion_key": lecture_key,
                    "kind": "resource",
                    "completion_kind": "written_response",
                    "resources": [{"id": resource_id, "type": resource_type, "title": title}],
                },
                {
                    "title": f"练习：{title}",
                    "detail": "完成主动回忆题并记录最容易混淆的一点。",
                    "minutes": 20,
                    "resource_types": ["quiz"],
                    "completion_key": practice_key,
                    "kind": "practice",
                    "completion_kind": "quiz_submission",
                    "resources": [{"id": material_ids["practice"], "type": "quiz", "title": "数据结构阶段练习"}],
                },
            ],
        })
        task_index += 2
    return path


def seed_usage(connection: sqlite3.Connection, student_id: str, now: datetime) -> dict[str, int]:
    account = connection.execute(
        "select login from user_accounts where id=?",
        (student_id,),
    ).fetchone()
    if account is None:
        raise SystemExit(f"account not found: {student_id}")

    workspace = connection.execute(
        "select state from learner_workspace_states where student_id=?",
        (student_id,),
    ).fetchone()
    if workspace:
        try:
            existing = json.loads(workspace[0]) if isinstance(workspace[0], str) else workspace[0]
        except (TypeError, json.JSONDecodeError):
            existing = {}
        if not isinstance(existing, dict) or existing.get("seed_tag") != SEED_TAG:
            raise SystemExit("refusing to overwrite an existing non-seed workspace state")

    remove_seed(connection, student_id)
    counts: dict[str, int] = {}

    offsets = [26, 24, 23, 21, 19, 18, 16, 14, 13, 11, 10, 8, 7, 5, 4, 3, 1, 0]
    minutes = [32, 45, 38, 52, 36, 48, 41, 55, 30, 63, 44, 50, 57, 39, 61, 46, 68, 34]
    routes = [
        "/desktop/path", "/desktop/resources", "/desktop/studio", "/desktop/practice",
        "/desktop/path", "/desktop/code-lab", "/desktop/resources", "/desktop/practice",
        "/desktop/studio", "/desktop/path", "/desktop/code-lab", "/desktop/practice",
        "/desktop/resources", "/desktop/path", "/desktop/practice", "/desktop/code-lab",
        "/desktop/resources", "/desktop",
    ]
    event_count = 0
    for index, (offset, duration, route) in enumerate(zip(offsets, minutes, routes, strict=True)):
        day = (now - timedelta(days=offset)).replace(hour=11 + index % 8, minute=5, second=0, microsecond=0)
        events: list[tuple[str, dict[str, Any], datetime]] = [
            ("page_visit", {"route": route, "seed_tag": SEED_TAG}, day),
            ("view_duration", {"minutes": duration, "route": route, "seed_tag": SEED_TAG}, day + timedelta(minutes=2)),
        ]
        if route in {"/desktop/practice", "/desktop/code-lab"} or index % 5 == 1:
            questions = 6 + (index % 5)
            correct = max(1, questions - (1 if index % 3 else 2))
            events.append(("practice_count", {"questions": questions, "correct": correct, "topic": "数据结构", "seed_tag": SEED_TAG}, day + timedelta(minutes=duration - 3)))
        if index in {1, 3, 6, 8, 11, 14, 16}:
            events.append(("resource_feedback", {"useful": index != 8, "resource_title": "数据结构学习资料", "seed_tag": SEED_TAG}, day + timedelta(minutes=duration)))
        for event_type, payload, created_at in events:
            connection.execute(
                "insert into behavior_events(student_id,type,payload,created_at) values(?,?,?,?)",
                (student_id, event_type, encoded(payload), sql_time(created_at)),
            )
            event_count += 1
    counts["behavior_events"] = event_count

    materials = material_rows(student_id, now)
    connection.executemany(
        """insert into generated_materials(
            id,student_id,type,title,subtitle,meta,sources,knowledge_points,data,source,exam_id,created_at
        ) values(?,?,?,?,?,?,?,?,?,?,?,?)""",
        materials,
    )
    counts["generated_materials"] = len(materials)
    material_ids = {
        key: f"{ID_PREFIX}_material_{key}"
        for key in ("arrays", "stack_tree_map", "practice", "sorting_code", "review_note")
    }

    papers = paper_payloads()
    wrong_rows = []
    attempt_rows = []
    for paper in papers:
        paper_id = f"{ID_PREFIX}_paper_{paper['suffix']}"
        exam_id = f"{ID_PREFIX}_exam_{paper['suffix']}"
        created_at = now - timedelta(days=paper["age"], hours=2)
        questions = []
        answers = {}
        results = []
        wrong_questions = []
        for question_id, stem, answer, wrong_answer, point in paper["questions"]:
            is_correct = question_id in paper["correct"]
            chosen = answer if is_correct else wrong_answer
            questions.append({"id": question_id, "type": "blank", "stem": stem, "options": [], "answer": answer, "score": 20, "knowledge_point": point})
            answers[question_id] = chosen
            results.append({"question_id": question_id, "score": 20 if is_correct else 0, "correct": is_correct, "feedback": "回答正确" if is_correct else f"应回答：{answer}"})
            if not is_correct:
                wrong_questions.append({"id": question_id, "stem": stem, "chosen": chosen, "answer": answer, "explanation": f"复盘 {point} 的定义与边界条件。"})
                wrong_rows.append((
                    student_id, question_id, exam_id, "数据结构", point, "blank", stem,
                    answer, chosen, 0.0, f"应回答：{answer}；建议用最小例子重新推演。",
                    "conceptual" if point not in {"归并排序", "快速排序"} else "method",
                    sql_time(created_at + timedelta(minutes=35)),
                ))
        mastery = {}
        for _, _, _, _, point in paper["questions"]:
            mastery.setdefault(point, {"score": paper["score"], "level": "进阶" if paper["score"] >= 80 else "基础"})
        connection.execute(
            """insert into exam_papers(
                id,exam_id,student_id,topic,title,category,tags,starred,archived,paper_type,
                questions,answers,results,overall_score,mastery,status,created_at,updated_at
            ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                paper_id, exam_id, student_id, "数据结构与算法", paper["title"], "阶段练习",
                encoded(["数据结构", "阶段测验", "演示痕迹"]), 0, 0, "adaptive",
                encoded(questions), encoded(answers), encoded(results), paper["score"], encoded(mastery),
                "graded", sql_time(created_at), sql_time(created_at + timedelta(minutes=40)),
            ),
        )
        attempt_rows.append({
            "id": f"{ID_PREFIX}_attempt_{paper['suffix']}",
            "resourceId": material_ids["practice"],
            "title": paper["title"],
            "submittedAt": iso_time(created_at + timedelta(minutes=40)),
            "score": paper["score"],
            "correctCount": len(paper["correct"]),
            "total": len(paper["questions"]),
            "answers": answers,
            "wrongQuestions": wrong_questions,
        })
    counts["exam_papers"] = len(papers)
    if wrong_rows:
        connection.executemany(
            """insert into wrong_questions(
                student_id,question_id,exam_id,topic,knowledge_point,question_type,stem,answer,
                student_answer,score,feedback,error_type,created_at
            ) values(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            wrong_rows,
        )
    counts["wrong_questions"] = len(wrong_rows)

    assessment_id = f"{ID_PREFIX}_assessment_ds"
    assessment_time = now - timedelta(days=27, hours=1)
    assessment = {
        "summary": "线性表基础较稳，栈与队列可继续通过应用题巩固；树和哈希需要更多边界案例。",
        "narrative": "适合图示讲解后立即做短题，再用代码验证结构操作。",
        "strengths": ["数组与链表的基本操作", "能判断常见时间复杂度", "愿意用代码验证"],
        "gaps": ["递归调用栈", "二叉树遍历顺序", "哈希冲突处理"],
        "recommended_focus": ["栈与队列", "树遍历", "哈希冲突", "排序稳定性"],
        "knowledge_seed": {"数组与链表": 82, "栈与队列": 68, "树与二叉树": 74, "哈希表": 64, "排序与搜索": 78},
        "suggested_modules": ["explainer", "mindmap", "quiz", "code"],
        "seed_tag": SEED_TAG,
    }
    connection.execute(
        "insert into assessments(id,student_id,subject,self_level,analysis,created_at) values(?,?,?,?,?,?)",
        (assessment_id, student_id, "数据结构与算法", "基础", encoded(assessment), sql_time(assessment_time)),
    )
    counts["assessments"] = 1

    path_id = f"{ID_PREFIX}_path_ds"
    nodes = [
        {"id": "linear", "title": "线性表", "knowledge_points": ["数组", "链表"], "status": "completed", "children": []},
        {"id": "stack", "title": "栈与队列", "knowledge_points": ["栈", "循环队列"], "status": "completed", "children": []},
        {"id": "tree", "title": "树与二叉树", "knowledge_points": ["遍历", "BST"], "status": "current", "children": []},
        {"id": "hash", "title": "哈希表", "knowledge_points": ["哈希函数", "冲突处理"], "status": "todo", "children": []},
        {"id": "sort", "title": "排序", "knowledge_points": ["归并", "快速排序"], "status": "todo", "children": []},
    ]
    connection.execute(
        "insert into learning_paths(id,student_id,topic,nodes,progress,created_at,updated_at) values(?,?,?,?,?,?,?)",
        (path_id, student_id, "数据结构与算法", encoded(nodes), 0.5, sql_time(now - timedelta(days=28)), sql_time(now)),
    )
    counts["learning_paths"] = 1
    goal_rows = [
        (student_id, "完成数据结构阶段复习", "按 8 天路径完成线性表、树、哈希与排序复盘。", (now - timedelta(days=28)).date().isoformat(), (now + timedelta(days=14)).date().isoformat(), "数据结构与算法", path_id, 0.82, SEED_TAG, "active", 0.5, sql_time(now - timedelta(days=28)), sql_time(now)),
        (student_id, "练习正确率稳定在 85%", "每周至少完成两次短测并复盘错题。", (now - timedelta(days=20)).date().isoformat(), (now + timedelta(days=30)).date().isoformat(), "阶段练习", path_id, 0.85, SEED_TAG, "active", 0.68, sql_time(now - timedelta(days=20)), sql_time(now)),
    ]
    connection.executemany(
        """insert into learning_goals(
            student_id,title,description,start_date,target_date,topic,path_id,target_mastery,source,
            status,progress,created_at,updated_at
        ) values(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        goal_rows,
    )
    counts["learning_goals"] = len(goal_rows)

    cards = [
        ("stack", "栈和队列最核心的访问差异是什么？", "栈是后进先出，队列是先进先出。", "栈与队列", "访问规则", 6, 3, "review"),
        ("tree", "二叉搜索树中序遍历为什么有序？", "因为递归访问顺序是左子树、根、右子树。", "树与二叉树", "中序遍历", 3, 2, "review"),
        ("hash", "开放寻址法遇到冲突后做什么？", "按探测序列寻找表中的下一个可用槽位。", "哈希表", "冲突处理", 1, 1, "learning"),
        ("merge", "归并排序的时间复杂度是多少？", "平均和最坏都是 O(n log n)。", "排序", "归并排序", 8, 4, "review"),
    ]
    review_rows = []
    for index, (suffix, front, back, topic, point, interval, repetitions, state) in enumerate(cards):
        card_id = f"{ID_PREFIX}_card_{suffix}"
        created_at = now - timedelta(days=18 - index * 2)
        connection.execute(
            """insert into memory_cards(
                id,student_id,front,back,topic,knowledge_point,source,source_id,ease_factor,
                interval_days,repetitions,due_date,state,created_at
            ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (card_id, student_id, front, back, topic, point, SEED_TAG, assessment_id, 2.45, interval, repetitions, (now + timedelta(days=max(0, index - 1))).date().isoformat(), state, sql_time(created_at)),
        )
        for review_index in range(min(2, repetitions)):
            reviewed_at = created_at + timedelta(days=review_index * max(1, interval // 2), hours=1)
            review_rows.append((card_id, student_id, 3 if review_index else 2, review_index, max(1, interval // 2), 2.35 + review_index * 0.1, sql_time(reviewed_at)))
    if review_rows:
        connection.executemany(
            "insert into review_logs(card_id,student_id,rating,interval_before,interval_after,ease_after,created_at) values(?,?,?,?,?,?,?)",
            review_rows,
        )
    counts["memory_cards"] = len(cards)
    counts["review_logs"] = len(review_rows)

    conversation_rows = [
        (
            f"{ID_PREFIX}_conversation_plan", student_id, "数据结构复习计划", "general", "raccoon",
            encoded([
                {"id": "seed_m1", "role": "user", "content": "我想用两周把数据结构复习一遍，树和哈希比较薄弱。"},
                {"id": "seed_m2", "role": "assistant", "content": "已按每天约 50 分钟安排 8 个阶段，并把树遍历、哈希冲突和排序放在后半程重点复盘。"},
            ]), "", "", "", 0, int((now - timedelta(days=28)).timestamp() * 1000), sql_time(now - timedelta(days=28)), sql_time(now - timedelta(days=28)),
        ),
        (
            f"{ID_PREFIX}_conversation_review", student_id, "树与哈希错题复盘", "general", "raccoon",
            encoded([
                {"id": "seed_m3", "role": "user", "content": "中序遍历和开放寻址我还是容易混淆。"},
                {"id": "seed_m4", "role": "assistant", "content": "先记住中序遍历是左—根—右；开放寻址则是在同一张表里沿探测序列寻找新槽位。建议各写一个最小例子。"},
            ]), "", "", "", 0, int((now - timedelta(days=4)).timestamp() * 1000), sql_time(now - timedelta(days=4)), sql_time(now - timedelta(days=4)),
        ),
    ]
    connection.executemany(
        """insert into conversation_sessions(
            id,student_id,title,kind,teacher,messages,resource_id,resource_title,resource_context,
            is_active,client_updated_at,created_at,updated_at
        ) values(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        conversation_rows,
    )
    counts["conversation_sessions"] = len(conversation_rows)

    path = build_path(material_ids)
    completed_keys = [f"{ID_PREFIX}_task_{index:02d}" for index in range(1, 9)]
    task_evidence = {}
    for index, key in enumerate(completed_keys, 1):
        completed_at = now - timedelta(days=max(1, 18 - index * 2), hours=2)
        task_evidence[key] = {
            "kind": "quiz_submission" if index % 2 == 0 else "written_response",
            "content": "完成阶段练习并写下复盘要点。" if index % 2 == 0 else "完成学习资料，整理了核心概念与一个反例。",
            "completedAt": iso_time(completed_at),
            "passed": True,
        }
    current_conversation = connection.execute(
        "select id from conversation_sessions where student_id=? and is_active=1 order by updated_at desc limit 1",
        (student_id,),
    ).fetchone()
    active_conversation_id = current_conversation[0] if current_conversation else f"{ID_PREFIX}_conversation_review"
    state = {
        "seed_tag": SEED_TAG,
        "messages": [],
        "conversationHistory": [],
        "activeConversationId": active_conversation_id,
        "activeConversationTitle": "",
        "activeConversationUpdatedAt": int(now.timestamp() * 1000),
        "activeConversationKind": "general",
        "activeResourceId": "",
        "activeResourceTitle": "",
        "activeResourceContext": "",
        "activeTeacher": "raccoon",
        "resources": [],
        "path": path,
        "pathScheduleAnchor": (now - timedelta(days=6)).date().isoformat(),
        "subjectPathControls": {
            "legacy-current-path": {
                "status": "active",
                "activationDate": (now - timedelta(days=6)).date().isoformat(),
                "dailyMinutes": 50,
                "updatedAt": int(now.timestamp() * 1000),
            },
        },
        "resourcePathAttachments": {},
        "profile": [
            {"key": "knowledge_level", "label": "知识基础", "value": 76, "delta": 6},
            {"key": "cognitive_style", "label": "认知匹配", "value": 84, "delta": 8},
            {"key": "goals", "label": "目标清晰", "value": 88, "delta": 10},
            {"key": "error_profile", "label": "易错管理", "value": 72, "delta": 7},
            {"key": "pace", "label": "学习节奏", "value": 79, "delta": 5},
            {"key": "interests", "label": "兴趣投入", "value": 82, "delta": 6},
        ],
        "tags": ["数据结构学习中", "栈与队列薄弱", "偏好图示讲解", "练习正确率 81%"],
        "profileUpdatedAt": iso_time(now - timedelta(days=1)),
        "profileSources": ["数据结构摸底测评", "3 次阶段练习", "18 天学习活动"],
        "planTasks": [],
        "planReason": "根据摸底结果与近期练习记录持续调整。",
        "hasRunMain": True,
        "practiceAttempts": sorted(attempt_rows, key=lambda item: item["submittedAt"], reverse=True),
        "adjustments": [{
            "id": f"{ID_PREFIX}_adjustment_latest",
            "submittedAt": attempt_rows[-1]["submittedAt"],
            "score": attempt_rows[-1]["score"],
            "text": "排序与哈希综合练习 88 分；路径继续推进，并保留一次哈希冲突针对性复盘。",
        }],
        "completedMaterials": completed_keys,
        "taskEvidence": task_evidence,
        "watchedVideos": [],
        "plans": {},
    }
    connection.execute(
        """insert into learner_workspace_states(
            student_id,version,state,client_updated_at,created_at,updated_at
        ) values(?,?,?,?,?,?)""",
        (student_id, 1, encoded(state), int(now.timestamp() * 1000), sql_time(now), sql_time(now)),
    )
    counts["learner_workspace_states"] = 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--student-id", required=True)
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--remove", action="store_true")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    connection = sqlite3.connect(args.database)
    connection.execute("pragma foreign_keys=on")
    try:
        with connection:
            if args.remove:
                summary = remove_seed(connection, args.student_id)
                action = "removed"
            else:
                summary = seed_usage(connection, args.student_id, now)
                action = "seeded"
    finally:
        connection.close()
    print(encoded({"action": action, "student_id": args.student_id, "seed_tag": SEED_TAG, "rows": summary}))


if __name__ == "__main__":
    main()
