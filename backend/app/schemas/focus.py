"""Versioned curriculum, deliberately independent of calendars and learner state."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Prerequisites(StrictModel):
    all_of: list[str] = Field(default_factory=list)
    any_of_groups: list[list[str]] = Field(default_factory=list)


class FocusModule(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=40)
    description: str = Field(default="", max_length=120)
    color: Literal["red", "blue", "green", "brown", "purple", "teal"] = "green"


class FocusNode(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_.-]{1,100}$")
    title: str = Field(min_length=1, max_length=48)
    module_id: str
    objective: str = Field(min_length=1, max_length=600)
    knowledge_point_ids: list[str] = Field(min_length=1)
    prerequisites: Prerequisites = Field(default_factory=Prerequisites)
    kind: Literal["core", "extension", "milestone"] = "core"
    estimated_minutes: int = Field(default=40, ge=5, le=600)
    icon: str = Field(default="book", max_length=30)
    source_ids: list[str] = Field(default_factory=list)
    completion_rule_id: str = "concept-check-v1"


class FocusRelation(StrictModel):
    source: str
    target: str
    kind: Literal["recommended", "related"]
    reason: str = Field(default="", max_length=200)


class FocusSource(StrictModel):
    id: str
    title: str
    url: str = ""


class CourseGraph(StrictModel):
    title: str = Field(min_length=1, max_length=80)
    goal: str = Field(min_length=1, max_length=1200)
    modules: list[FocusModule] = Field(min_length=1, max_length=12)
    knowledge_inventory: list[str] = Field(min_length=1, max_length=160)
    nodes: list[FocusNode] = Field(min_length=1, max_length=120)
    relations: list[FocusRelation] = Field(default_factory=list, max_length=240)
    sources: list[FocusSource] = Field(default_factory=list, max_length=30)


class StateAction(StrictModel):
    request_id: str = Field(min_length=8, max_length=100)
    revision: int = Field(ge=0)
    action: Literal["start", "pause", "task", "budget", "submit"]
    node_id: str = ""
    task: Literal["lesson", "example"] | None = None
    daily_minutes: int | None = Field(default=None, ge=10, le=480)
    package_version: int | None = None
    answers: dict[str, str] = Field(default_factory=dict, max_length=30)


class PrepareRequest(StrictModel):
    request_id: str = Field(min_length=8, max_length=100)


class GenerateGraphRequest(PrepareRequest):
    title: str = Field(min_length=2, max_length=80)
    goal: str = Field(min_length=4, max_length=1200)
    source_outline: str = Field(min_length=20, max_length=30000)


def validate_graph(graph: CourseGraph) -> CourseGraph:
    ids = [n.id for n in graph.nodes]
    modules = [m.id for m in graph.modules]
    inventory = graph.knowledge_inventory
    sources = [s.id for s in graph.sources]
    for name, values in (("节点", ids), ("章节", modules), ("知识清单", inventory), ("来源", sources)):
        if len(values) != len(set(values)):
            raise ValueError(f"{name} ID 重复")
    lookup = {n.id: n for n in graph.nodes}
    covered: list[str] = []
    for node in graph.nodes:
        if node.module_id not in modules:
            raise ValueError(f"{node.id} 的章节不存在")
        covered.extend(node.knowledge_point_ids)
        if set(node.source_ids) - set(sources):
            raise ValueError(f"{node.id} 的资料来源不存在")
        groups = node.prerequisites.any_of_groups
        if any(not group or len(group) != len(set(group)) for group in groups):
            raise ValueError(f"{node.id} 包含空的或重复的备选前置")
        deps = node.prerequisites.all_of + [p for group in groups for p in group]
        if node.id in deps or set(deps) - set(ids):
            raise ValueError(f"{node.id} 的前置引用无效")
        if len(node.prerequisites.all_of) != len(set(node.prerequisites.all_of)):
            raise ValueError(f"{node.id} 的前置重复")
    if set(covered) != set(inventory) or len(covered) != len(set(covered)):
        raise ValueError("知识清单有遗漏、重复归属或清单外的知识点")
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str):
        if node_id in visiting:
            raise ValueError("硬前置包含循环依赖")
        if node_id in visited:
            return
        visiting.add(node_id)
        prereq = lookup[node_id].prerequisites
        for parent in prereq.all_of + [p for group in prereq.any_of_groups for p in group]:
            visit(parent)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in ids:
        visit(node_id)
    reachable: set[str] = set()
    while True:
        additions = {n.id for n in graph.nodes if prerequisites_met(n, reachable)} - reachable
        if not additions:
            break
        reachable.update(additions)
    if set(ids) - reachable:
        raise ValueError("存在无法到达的节点")
    for edge in graph.relations:
        if edge.source not in lookup or edge.target not in lookup or edge.source == edge.target:
            raise ValueError("建议或关联关系引用无效")
    return graph


def prerequisites_met(node: FocusNode, passed: set[str]) -> bool:
    return set(node.prerequisites.all_of) <= passed and all(
        bool(set(group) & passed) for group in node.prerequisites.any_of_groups
    )
