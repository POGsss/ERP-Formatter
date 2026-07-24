from typing import Any

try:
    from .new_pos_transformer import NewPosTransformer
    from .transformer import DataTransformer
except ImportError:
    try:
        from services.new_pos_transformer import NewPosTransformer
        from services.transformer import DataTransformer
    except ModuleNotFoundError:
        from new_pos_transformer import NewPosTransformer
        from transformer import DataTransformer


DEFAULT_TEMPLATE_KEY = "old_pos"

TEMPLATE_REGISTRY: dict[str, dict[str, Any]] = {
    "old_pos": {
        "label": "Old POS Template",
        "description": "Processes the standard POS export into the 12-column ERP format.",
        "transformer": DataTransformer,
        "number_columns": {
            "Quantity",
            "Unit Price",
            "Amount",
            "Term Amount",
        },
        "date_columns": {"Invoice Date"},
    },
    "new_pos": {
        "label": "New POS Template",
        "description": (
            "Processes payment-method breakdown exports into per-payment ERP rows."
        ),
        "transformer": NewPosTransformer,
        "number_columns": {
            "Amount",
            "Sales Discount",
            "VAT Payable",
            "Quantity",
            "Product Code",
        },
        "date_columns": {"Invoice Date"},
    },
}

# A concise alias for callers that treat the registry as the template list.
TEMPLATES = TEMPLATE_REGISTRY


def get_transformer(key: str):
    """Return a new transformer instance for a registered template key."""
    try:
        transformer_class = TEMPLATE_REGISTRY[key]["transformer"]
    except KeyError as exc:
        raise ValueError(f'Unknown template "{key}".') from exc
    return transformer_class()


def public_templates() -> list[dict[str, Any]]:
    """Return registry metadata that is safe to expose through the API."""
    return [
        {
            "key": key,
            "label": definition["label"],
            "description": definition["description"],
            "is_default": key == DEFAULT_TEMPLATE_KEY,
        }
        for key, definition in TEMPLATE_REGISTRY.items()
    ]
