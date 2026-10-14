"""Review identity excludes presentation-only metadata, never approved content."""
import hashlib
import json

TRANSPORT_FIELDS = {"review", "reviewed", "review_approved", "review_score", "review_gate_status", "review_auto_released", "review_warnings", "content_hash", "artifact_version", "plan_version", "evidence_version", "review_policy_version"}
# Rendering is queued after script approval and does not alter the script.
TRANSPORT_FIELDS.update({"media_task_id", "media_status"})
TRANSPORT_FIELDS.add("_semantic_covered_requirements")


def content_hash(resource):
    payload = {k: v for k, v in resource.items() if k not in TRANSPORT_FIELDS}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def review_matches(resource, review):
    if not review or review.get("approved") is not True or review.get("auto_released") or review.get("gate_status") == "approved_after_rework_limit":
        return False
    if int(resource.get("retry_count") or 0) != int(review.get("retry_count") or 0):
        return False
    if review.get("plan_version") and resource.get("plan_version") != review["plan_version"]:
        return False
    return not review.get("content_hash") or review["content_hash"] == content_hash(resource)
