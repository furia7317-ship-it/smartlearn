"""User controls are distinct from server-resolved execution budgets."""
from typing import Literal

from pydantic import BaseModel, Field

Effort = Literal["auto", "fast", "standard", "deep", "rigorous"]


class SourcePolicy(BaseModel):
    course: bool = True
    personal: bool = True
    web: bool = False
    # IDs constrain retrieval within the authenticated account's permitted sources.
    document_ids: list[str] = Field(default_factory=list, max_length=30)


class CollaborationOptions(BaseModel):
    effort: Effort = "standard"
    preference: Literal["auto", "parallel", "staged"] = "auto"
    auto_max_effort: Literal["fast", "standard", "deep", "rigorous"] = "deep"
    sources: SourcePolicy = Field(default_factory=SourcePolicy)
