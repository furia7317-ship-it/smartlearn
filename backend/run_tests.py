"""手动运行测试验证。"""
import sys
sys.path.insert(0, ".")

from app.services.scoring import (
    grade_mcq_questions,
    calculate_overall,
    calculate_mastery,
    trim_composition,
    should_enter_wrongbook,
    get_mastery_level,
)

print("=" * 50)
print("学枢 — scoring.py 测试")
print("=" * 50)

# Test 1: grade_mcq
questions = [
    {"id": "q1", "type": "mcq", "answer": "A", "score": 10, "knowledge_point": "排序"},
    {"id": "q2", "type": "mcq", "answer": "B", "score": 10, "knowledge_point": "排序"},
]
results = grade_mcq_questions(questions, {"q1": "A", "q2": "B"})
assert all(r["correct"] for r in results)
print("[PASS] grade_mcq: all correct")

# Test 2: grade_mcq wrong
results2 = grade_mcq_questions(questions, {"q1": "B", "q2": "B"})
assert not results2[0]["correct"]
assert results2[1]["correct"]
print("[PASS] grade_mcq: partial correct")

# Test 3: calculate_overall
overall = calculate_overall(results)
assert overall == 100.0
overall2 = calculate_overall(results2)
assert overall2 == 50.0
print(f"[PASS] calculate_overall: 100.0 and {overall2}")

# Test 4: trim_composition
comp = trim_composition({"mcq": 3, "blank": 1, "short": 1, "code": 0})
assert comp["mcq"] == 3
print(f"[PASS] trim_composition: {comp}")

comp2 = trim_composition({"mcq": 0, "blank": 0, "short": 0, "code": 0})
assert sum(comp2.values()) >= 3
print(f"[PASS] trim_composition fallback: {comp2}")

# Test 5: should_enter_wrongbook
assert should_enter_wrongbook(3, 10) is True
assert should_enter_wrongbook(8, 10) is False
assert should_enter_wrongbook(3, 10, source="wrongbook") is False
print("[PASS] should_enter_wrongbook")

# Test 6: get_mastery_level
assert get_mastery_level(1.0) == "完全掌握"
assert get_mastery_level(0.85) == "优秀"
assert get_mastery_level(0.70) == "及格"
assert get_mastery_level(0.50) == "不及格"
print("[PASS] get_mastery_level")

print()
print("=" * 50)
print("ALL SCORING TESTS PASSED!")
print("=" * 50)

# Test graph compilation
print()
print("测试 LangGraph 图编译...")
try:
    from app.graph.resource_graph import resource_app
    print(f"[PASS] resource_graph: {list(resource_app.get_graph().nodes.keys())}")
except Exception as e:
    print(f"[WARN] resource_graph: {e}")

try:
    from app.graph.exam_graph import exam_app
    print(f"[PASS] exam_graph: {list(exam_app.get_graph().nodes.keys())}")
except Exception as e:
    print(f"[WARN] exam_graph: {e}")

try:
    from app.graph.grade_graph import grade_app
    print(f"[PASS] grade_graph: {list(grade_app.get_graph().nodes.keys())}")
except Exception as e:
    print(f"[WARN] grade_graph: {e}")

try:
    from app.graph.viz import get_all_graphs
    graphs = get_all_graphs()
    print(f"[PASS] viz: all graphs exported ({list(graphs.keys())})")
except Exception as e:
    print(f"[WARN] viz: {e}")

print()
print("测试 LLM JSON 解析...")
from app.core.llm import parse_json_response
assert parse_json_response('{"key": "value"}') == {"key": "value"}
assert parse_json_response('[1, 2, 3]') == [1, 2, 3]
assert parse_json_response('```json\n{"key": "value"}\n```') == {"key": "value"}
print("[PASS] parse_json_response")

print()
print("所有测试完成！")
