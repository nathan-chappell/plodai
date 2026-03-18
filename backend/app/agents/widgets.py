from __future__ import annotations

from typing import Any, Literal, Sequence, TypedDict

from chatkit.actions import ActionConfig

from backend.app.chatkit.feedback_types import (
    ChatItemFeedbackRecord,
    FeedbackKind,
    FeedbackLabel,
)
from backend.app.chatkit.metadata import AgentPlan


class WidgetStatus(TypedDict):
    text: str
    icon: str


class BadgeWidget(TypedDict, total=False):
    type: Literal["Badge"]
    label: str
    color: str
    variant: str
    pill: bool
    size: Literal["sm", "md", "lg"]


class TitleWidget(TypedDict, total=False):
    type: Literal["Title"]
    value: str
    size: str


class CaptionWidget(TypedDict, total=False):
    type: Literal["Caption"]
    value: str
    color: str
    size: Literal["sm", "md", "lg"]


class TextWidget(TypedDict, total=False):
    type: Literal["Text"]
    value: str
    size: str
    weight: str
    color: str


class DividerWidget(TypedDict, total=False):
    type: Literal["Divider"]
    size: int | str
    spacing: int | str


class LabelWidget(TypedDict, total=False):
    type: Literal["Label"]
    value: str
    fieldName: str
    size: str
    weight: str
    color: str


class RadioOption(TypedDict):
    label: str
    value: str


class RadioGroupWidget(TypedDict, total=False):
    type: Literal["RadioGroup"]
    name: str
    options: list[RadioOption]
    ariaLabel: str
    defaultValue: str
    direction: Literal["row", "col"]


class TextareaWidget(TypedDict, total=False):
    type: Literal["Textarea"]
    name: str
    defaultValue: str
    placeholder: str
    rows: int
    autoResize: bool
    maxRows: int
    variant: str


class CardActionWidget(TypedDict):
    label: str
    action: dict[str, object]


WidgetComponent = (
    BadgeWidget
    | TitleWidget
    | CaptionWidget
    | TextWidget
    | DividerWidget
    | LabelWidget
    | RadioGroupWidget
    | TextareaWidget
)


class CardWidget(TypedDict, total=False):
    type: Literal["Card"]
    size: str
    padding: int | str
    status: WidgetStatus
    children: list[WidgetComponent]
    asForm: bool
    confirm: CardActionWidget
    cancel: CardActionWidget


# ChatKit accepts Card, ListView, or Basic as a root widget. We currently emit
# Cards directly, which are valid roots and do not require an extra wrapper.
WidgetRoot = CardWidget


def format_tool_label(tool_name: str) -> str:
    return " ".join(
        part.capitalize() for part in tool_name.strip().split("_") if part.strip()
    )


def build_tool_trace_widget(
    tool_name: str,
    summary: str,
    details: Sequence[str] | None = None,
) -> WidgetRoot:
    children: list[WidgetComponent] = [
        _badge_widget("Tool", color="info", size="sm"),
        _title_widget(format_tool_label(tool_name), size="sm"),
        _caption_widget(summary, size="sm"),
    ]

    clean_details = [detail.strip() for detail in details or [] if detail.strip()]
    if clean_details:
        children.append(_divider_widget(size=1, spacing=8))
        children.extend(_text_widget(detail) for detail in clean_details[:6])

    return _card_widget(
        size="sm",
        padding="12px",
        status_text="Tool requested",
        status_icon="bolt",
        children=children,
    )


def build_tool_trace_copy_text(
    tool_name: str,
    summary: str,
    details: Sequence[str] | None = None,
) -> str:
    clean_details = [detail.strip() for detail in details or [] if detail.strip()]
    return "\n".join([format_tool_label(tool_name), summary, *clean_details]).strip()


def build_workspace_context_widget(
    *,
    action_label: str,
    cwd_path: str,
    target_path: str | None = None,
) -> WidgetRoot:
    children: list[WidgetComponent] = [
        _badge_widget("Workspace", color="info", size="sm"),
        _title_widget(action_label, size="sm"),
        _caption_widget(f"Current directory: {cwd_path}", size="sm"),
    ]

    if target_path and target_path != cwd_path:
        children.extend(
            [
                _divider_widget(size=1, spacing=8),
                _text_widget(f"Target: {target_path}"),
            ]
        )

    return _card_widget(
        size="sm",
        padding="12px",
        status_text="Workspace updated",
        status_icon="cube",
        children=children,
    )


def build_workspace_context_copy_text(
    *,
    action_label: str,
    cwd_path: str,
    target_path: str | None = None,
) -> str:
    lines = [action_label, f"Current directory: {cwd_path}"]
    if target_path and target_path != cwd_path:
        lines.append(f"Target: {target_path}")
    return "\n".join(lines)


def build_plan_widget(plan: AgentPlan) -> WidgetRoot:
    steps = plan.get("planned_steps", [])
    success_criteria = plan.get("success_criteria", [])
    follow_on_tool_hints = plan.get("follow_on_tool_hints", [])
    focus = plan.get("focus") or "Execution plan"

    children: list[WidgetComponent] = [
        _badge_widget("Plan", color="discovery"),
        _title_widget(focus, size="lg"),
        _caption_widget(f"{len(steps)} step{'s' if len(steps) != 1 else ''} queued"),
        _divider_widget(),
    ]

    children.extend(
        _text_widget(f"{index}. {step}")
        for index, step in enumerate(steps, start=1)
    )

    if success_criteria:
        children.extend(
            [
                _divider_widget(),
                _text_widget("Success criteria", weight="semibold"),
                *(_text_widget(f"- {criterion}") for criterion in success_criteria),
            ]
        )

    if follow_on_tool_hints:
        children.extend(
            [
                _divider_widget(),
                _text_widget("Suggested next tools", weight="semibold"),
                _text_widget(", ".join(follow_on_tool_hints), color="secondary"),
            ]
        )

    return _card_widget(
        size="md",
        status_text="Plan captured",
        status_icon="check-circle",
        children=children,
    )


def build_plan_copy_text(plan: AgentPlan) -> str:
    cleaned_steps = [step for step in plan.get("planned_steps", []) if step]
    cleaned_success_criteria = [item for item in plan.get("success_criteria", []) if item]
    cleaned_follow_on_tool_hints = [item for item in plan.get("follow_on_tool_hints", []) if item]
    focus = (plan.get("focus") or "").strip()
    return "\n".join(
        [
            f"Plan: {focus}" if focus else "Plan",
            *(f"{index}. {step}" for index, step in enumerate(cleaned_steps, start=1)),
        ]
        + (
            ["", "Success criteria:", *[f"- {item}" for item in cleaned_success_criteria]]
            if cleaned_success_criteria
            else []
        )
        + (
            ["", "Suggested next tools:", ", ".join(cleaned_follow_on_tool_hints)]
            if cleaned_follow_on_tool_hints
            else []
        )
    ).strip()


def build_feedback_capture_widget(
    feedback: ChatItemFeedbackRecord,
) -> WidgetRoot:
    return {
        "type": "Card",
        "size": "md",
        "padding": "12px",
        "asForm": True,
        "status": {"text": "Feedback agent", "icon": "compass"},
        "children": [
            _badge_widget("Feedback", color="discovery"),
            _title_widget("Capture feedback", size="sm"),
            _caption_widget(
                "Review the latest assistant response and save a short, structured note.",
                size="sm",
            ),
            _divider_widget(),
            _label_widget("Did it go well?", field_name="kind"),
            _radio_group_widget(
                "kind",
                options=[
                    {"label": "Went well", "value": "positive"},
                    {"label": "Needs work", "value": "negative"},
                ],
                default_value=feedback.get("kind"),
            ),
            _divider_widget(spacing=8),
            _label_widget("Area", field_name="label"),
            _radio_group_widget(
                "label",
                options=[
                    {"label": "UI", "value": "ui"},
                    {"label": "Tools", "value": "tools"},
                    {"label": "Behavior", "value": "behavior"},
                ],
                default_value=feedback.get("label"),
            ),
            _divider_widget(spacing=8),
            _label_widget("Message", field_name="message"),
            _textarea_widget(
                "message",
                default_value=feedback.get("message"),
                placeholder="Add any extra detail that would help us improve the workflow.",
            ),
        ],
        "confirm": {
            "label": "Submit feedback",
            "action": _client_action(
                "submit_feedback_details",
                {"feedback_id": feedback["id"]},
            ),
        },
        "cancel": {
            "label": "Ignore",
            "action": _client_action(
                "cancel_feedback_details",
                {"feedback_id": feedback["id"]},
            ),
        },
    }


def build_feedback_capture_copy_text(feedback: ChatItemFeedbackRecord) -> str:
    item_ids = ", ".join(feedback.get("item_ids", [])) or "latest assistant response"
    return f"Feedback capture form for {item_ids}."


def _badge_widget(
    label: str,
    *,
    color: str,
    variant: str = "soft",
    pill: bool = True,
    size: Literal["sm", "md", "lg"] | None = None,
) -> BadgeWidget:
    widget: BadgeWidget = {
        "type": "Badge",
        "label": label,
        "color": color,
        "variant": variant,
        "pill": pill,
    }
    if size is not None:
        widget["size"] = size
    return widget


def _title_widget(value: str, *, size: str) -> TitleWidget:
    return {"type": "Title", "value": value, "size": size}


def _caption_widget(
    value: str,
    *,
    color: str = "secondary",
    size: Literal["sm", "md", "lg"] | None = None,
) -> CaptionWidget:
    widget: CaptionWidget = {"type": "Caption", "value": value, "color": color}
    if size is not None:
        widget["size"] = size
    return widget


def _label_widget(value: str, *, field_name: str) -> LabelWidget:
    return {
        "type": "Label",
        "value": value,
        "fieldName": field_name,
        "size": "sm",
        "weight": "semibold",
    }


def _radio_group_widget(
    name: str,
    *,
    options: list[RadioOption],
    default_value: FeedbackKind | FeedbackLabel | None,
) -> RadioGroupWidget:
    widget: RadioGroupWidget = {
        "type": "RadioGroup",
        "name": name,
        "options": options,
        "ariaLabel": name.replace("_", " "),
        "direction": "col",
    }
    if default_value is not None:
        widget["defaultValue"] = default_value
    return widget


def _textarea_widget(
    name: str,
    *,
    default_value: str | None,
    placeholder: str,
) -> TextareaWidget:
    widget: TextareaWidget = {
        "type": "Textarea",
        "name": name,
        "placeholder": placeholder,
        "rows": 4,
        "autoResize": True,
        "maxRows": 8,
        "variant": "outline",
    }
    if default_value:
        widget["defaultValue"] = default_value
    return widget


def _text_widget(
    value: str,
    *,
    size: str = "sm",
    weight: str | None = None,
    color: str | None = None,
) -> TextWidget:
    widget: TextWidget = {"type": "Text", "value": value, "size": size}
    if weight is not None:
        widget["weight"] = weight
    if color is not None:
        widget["color"] = color
    return widget


def _divider_widget(
    *,
    size: int | str | None = None,
    spacing: int | str | None = None,
) -> DividerWidget:
    widget: DividerWidget = {"type": "Divider"}
    if size is not None:
        widget["size"] = size
    if spacing is not None:
        widget["spacing"] = spacing
    return widget


def _card_widget(
    *,
    size: str,
    padding: int | str | None = None,
    status_text: str,
    status_icon: str,
    children: list[WidgetComponent],
) -> CardWidget:
    widget: CardWidget = {
        "type": "Card",
        "size": size,
        "status": {"text": status_text, "icon": status_icon},
        "children": children,
    }
    if padding is not None:
        widget["padding"] = padding
    return widget


def _client_action(action_type: str, payload: dict[str, Any]) -> dict[str, object]:
    config = ActionConfig(
        type=action_type,
        payload=payload,
        handler="client",
        loadingBehavior="container",
    )
    return config.model_dump(mode="json", exclude_none=True)
