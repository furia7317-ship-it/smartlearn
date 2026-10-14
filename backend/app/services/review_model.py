"""Capability adapter for bounded, structured reviewer responses."""


def adapt_review_model(model):
    # MiMo's default thinking tokens share max_tokens with the JSON answer.
    # A short review must reserve output for its verdict instead of ending
    # with reasoning-only output. Other providers receive no unsupported field.
    if str(getattr(model, "model_name", "")).lower().startswith("mimo"):
        return model.bind(extra_body={"thinking": {"type": "disabled"}})
    return model
