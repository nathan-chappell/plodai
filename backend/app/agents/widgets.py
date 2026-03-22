from __future__ import annotations

from typing import Any, Literal, Sequence, TypedDict

from chatkit.actions import ActionConfig

from backend.app.chatkit.feedback_types import ChatItemFeedbackRecord
from backend.app.chatkit.metadata import (
    AgentPlan,
    PendingFeedbackSession,
    TourPickerDisplayScenario,
    TourPickerDisplaySpec,
)


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


class ColWidget(TypedDict, total=False):
    type: Literal["Col"]
    children: list["WidgetComponent"]
    gap: int | str
    padding: int | str


WidgetComponent = (
    BadgeWidget
    | TitleWidget
    | CaptionWidget
    | TextWidget
    | DividerWidget
    | LabelWidget
    | RadioGroupWidget
    | TextareaWidget
    | ColWidget
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
        _format_tool_label_part(part)
        for part in tool_name.strip().split("_")
        if part.strip()
    )


def _format_tool_label_part(part: str) -> str:
    normalized = part.strip().lower()
    if normalized in {"csv", "json", "pdf", "sql"}:
        return normalized.upper()
    if normalized == "ai":
        return "AI"
    return normalized.capitalize()


def build_tool_trace_widget(
    tool_name: str,
    summary: str,
    details: Sequence[str] | None = None,
    *,
    title: str | None = None,
) -> WidgetRoot:
    del details
    content_children: list[WidgetComponent] = [
        _badge_widget("Tool", color="info", size="sm"),
        _text_widget(title or summary or format_tool_label(tool_name), size="sm", weight="semibold"),
    ]

    return _card_widget(
        size="sm",
        padding="8px",
        children=[_col_widget(content_children, gap="4px")],
    )


def build_tool_trace_copy_text(
    tool_name: str,
    summary: str,
    details: Sequence[str] | None = None,
    *,
    title: str | None = None,
) -> str:
    del details
    return (title or summary or format_tool_label(tool_name)).strip()


def build_handoff_trace_widget(
    *,
    source_agent_name: str,
    target_agent_name: str,
    handoff_tool_name: str | None = None,
    summary: str | None = None,
    details: Sequence[str] | None = None,
) -> WidgetRoot:
    del handoff_tool_name, summary, details
    content_children: list[WidgetComponent] = [
        _badge_widget("Handoff", color="discovery", size="sm"),
        _text_widget(
            f"{source_agent_name} -> {target_agent_name}",
            size="sm",
            weight="semibold",
        ),
    ]

    return _card_widget(
        size="sm",
        padding="8px",
        children=[_col_widget(content_children, gap="4px")],
    )


def build_handoff_trace_copy_text(
    *,
    source_agent_name: str,
    target_agent_name: str,
    handoff_tool_name: str | None = None,
    summary: str | None = None,
    details: Sequence[str] | None = None,
) -> str:
    del handoff_tool_name, summary, details
    return f"{source_agent_name} -> {target_agent_name}"


def build_workspace_context_widget(
    *,
    action_label: str,
    path_prefix: str,
    target_path: str | None = None,
) -> WidgetRoot:
    content_children: list[WidgetComponent] = [
        _badge_widget("Workspace", color="info", size="sm"),
        _text_widget(action_label, size="sm", weight="semibold"),
        _caption_widget(f"Active prefix: {path_prefix}", size="sm"),
    ]

    if target_path and target_path != path_prefix:
        content_children.extend(
            [
                _divider_widget(size=1, spacing=4),
                _text_widget(f"Target: {target_path}", size="xs"),
            ]
        )

    return _card_widget(
        size="sm",
        padding="8px",
        status_text="Workspace updated",
        status_icon="cube",
        children=[_col_widget(content_children, gap="4px")],
    )


def build_workspace_context_copy_text(
    *,
    action_label: str,
    path_prefix: str,
    target_path: str | None = None,
) -> str:
    lines = [action_label, f"Active prefix: {path_prefix}"]
    if target_path and target_path != path_prefix:
        lines.append(f"Target: {target_path}")
    return "\n".join(lines)


def build_plan_widget(plan: AgentPlan) -> WidgetRoot:
    steps = plan.get("planned_steps", [])
    success_criteria = plan.get("success_criteria", [])
    follow_on_tool_hints = plan.get("follow_on_tool_hints", [])
    focus = plan.get("focus") or "Execution plan"

    content_children: list[WidgetComponent] = [
        _badge_widget("Plan", color="discovery"),
        _title_widget(focus, size="md"),
        _caption_widget(f"{len(steps)} step{'s' if len(steps) != 1 else ''} queued"),
        _divider_widget(spacing=4),
    ]

    content_children.extend(
        _text_widget(f"{index}. {step}", size="xs")
        for index, step in enumerate(steps, start=1)
    )

    if success_criteria:
        content_children.extend(
            [
                _divider_widget(spacing=4),
                _text_widget("Success criteria", size="xs", weight="semibold"),
                *(
                    _text_widget(f"- {criterion}", size="xs")
                    for criterion in success_criteria
                ),
            ]
        )

    if follow_on_tool_hints:
        content_children.extend(
            [
                _divider_widget(spacing=4),
                _text_widget("Suggested next tools", size="xs", weight="semibold"),
                _text_widget(
                    ", ".join(follow_on_tool_hints), size="xs", color="secondary"
                ),
            ]
        )

    return _card_widget(
        size="md",
        status_text="Plan captured",
        status_icon="check-circle",
        children=[_col_widget(content_children, gap="5px")],
    )


def build_plan_copy_text(plan: AgentPlan) -> str:
    cleaned_steps = [step for step in plan.get("planned_steps", []) if step]
    cleaned_success_criteria = [
        item for item in plan.get("success_criteria", []) if item
    ]
    cleaned_follow_on_tool_hints = [
        item for item in plan.get("follow_on_tool_hints", []) if item
    ]
    focus = (plan.get("focus") or "").strip()
    return "\n".join(
        [
            f"Plan: {focus}" if focus else "Plan",
            *(f"{index}. {step}" for index, step in enumerate(cleaned_steps, start=1)),
        ]
        + (
            [
                "",
                "Success criteria:",
                *[f"- {item}" for item in cleaned_success_criteria],
            ]
            if cleaned_success_criteria
            else []
        )
        + (
            ["", "Suggested next tools:", ", ".join(cleaned_follow_on_tool_hints)]
            if cleaned_follow_on_tool_hints
            else []
        )
    ).strip()


def build_feedback_session_widget(
    session: PendingFeedbackSession,
) -> WidgetRoot:
    is_confirmation = session["mode"] == "confirmation"
    content_children: list[WidgetComponent] = [
        _badge_widget("Feedback", color="discovery"),
        _title_widget(
            "Confirm feedback" if is_confirmation else "Capture feedback",
            size="sm",
        ),
    ]

    if not is_confirmation:
        content_children.extend(
            [
                _divider_widget(spacing=4),
                _label_widget("Suggestions", field_name="selected_option"),
                _radio_group_widget(
                    "selected_option",
                    options=[
                        {"label": option, "value": option}
                        for option in session["recommended_options"]
                    ],
                    default_value=(
                        session["message_draft"]
                        if session["message_draft"] in session["recommended_options"]
                        else None
                    ),
                ),
            ]
        )

    content_children.extend(
        [
            _divider_widget(spacing=4),
            _label_widget("Message", field_name="message"),
            _textarea_widget(
                "message",
                default_value=session.get("message_draft"),
                placeholder="Short feedback note.",
            ),
            _divider_widget(spacing=4),
            _label_widget("Sentiment", field_name="sentiment"),
            _radio_group_widget(
                "sentiment",
                options=[
                    {"label": "Positive", "value": "positive"},
                    {"label": "Negative", "value": "negative"},
                ],
                default_value=session.get("inferred_sentiment"),
            ),
        ]
    )

    return {
        "type": "Card",
        "size": "md",
        "padding": "8px",
        "asForm": True,
        "status": {"text": "Feedback agent", "icon": "compass"},
        "children": [_col_widget(content_children, gap="4px")],
        "confirm": {
            "label": "Save feedback",
            "action": _client_action(
                "submit_feedback_session",
                {"session_id": session["session_id"]},
            ),
        },
        "cancel": {
            "label": "Cancel",
            "action": _client_action(
                "cancel_feedback_session",
                {"session_id": session["session_id"]},
            ),
        },
    }


def build_feedback_session_copy_text(session: PendingFeedbackSession) -> str:
    item_ids = ", ".join(session["item_ids"]) or "latest assistant response"
    return f"Feedback form for {item_ids}."


def build_feedback_saved_widget(feedback: ChatItemFeedbackRecord) -> WidgetRoot:
    sentiment_label = feedback.kind.capitalize() if feedback.kind else "Unspecified"
    children: list[WidgetComponent] = [
        _badge_widget("Feedback", color="success", size="sm"),
        _title_widget("Feedback saved", size="sm"),
        _caption_widget(
            f"{sentiment_label} feedback linked to the latest assistant response.",
            size="sm",
        ),
        _divider_widget(spacing=6),
        _text_widget(feedback.message or "No message provided.", size="xs"),
    ]
    return _card_widget(
        size="sm",
        padding="10px",
        status_text="Feedback saved",
        status_icon="check-circle",
        children=[_col_widget(children, gap="6px")],
    )


def build_feedback_saved_copy_text(feedback: ChatItemFeedbackRecord) -> str:
    sentiment = feedback.kind or "unspecified"
    message = feedback.message or "No message provided."
    return f"Feedback saved. Sentiment: {sentiment}. Message: {message}"


def build_tour_picker_widget(
    picker: TourPickerDisplaySpec,
) -> WidgetRoot:
    children: list[WidgetComponent] = [
        _badge_widget("Guided Tour", color="discovery"),
        _title_widget(picker["title"], size="sm"),
        _text_widget(picker["summary"], size="sm"),
        _divider_widget(spacing=4),
        _label_widget("Tour", field_name="scenario_id"),
        _radio_group_widget(
            "scenario_id",
            options=[
                {
                    "label": _tour_picker_option_label(scenario),
                    "value": scenario["scenario_id"],
                }
                for scenario in picker["scenarios"]
            ],
            default_value=picker["scenarios"][0]["scenario_id"],
        ),
    ]

    for scenario in picker["scenarios"]:
        children.extend(
            [
                _divider_widget(spacing=4),
                _text_widget(scenario["title"], size="sm", weight="semibold"),
                _caption_widget(scenario["summary"], size="sm"),
                _caption_widget(
                    _tour_picker_default_assets_copy(scenario["default_asset_count"]),
                    size="sm",
                ),
            ]
        )

    return {
        "type": "Card",
        "size": "md",
        "padding": "8px",
        "asForm": True,
        "status": {"text": "Guided tour", "icon": "compass"},
        "children": [_col_widget(children, gap="4px")],
        "confirm": {
            "label": "Open launcher",
            "action": _client_action("submit_tour_picker", {}),
        },
        "cancel": {
            "label": "Cancel",
            "action": _client_action("cancel_tour_picker", {}),
        },
    }


def build_tour_picker_copy_text(picker: TourPickerDisplaySpec) -> str:
    scenario_titles = ", ".join(
        scenario["title"] for scenario in picker["scenarios"][:3]
    )
    suffix = "" if len(picker["scenarios"]) <= 3 else ", ..."
    return f"{picker['title']}: {scenario_titles}{suffix}"


def build_feedback_capture_copy_text(feedback: ChatItemFeedbackRecord) -> str:
    item_ids = ", ".join(feedback.item_ids) or "latest assistant response"
    return f"Feedback capture form for {item_ids}."


def build_feedback_capture_widget(
    feedback: ChatItemFeedbackRecord,
) -> WidgetRoot:
    session: PendingFeedbackSession = {
        "session_id": feedback.id,
        "item_ids": list(feedback.item_ids),
        "recommended_options": [
            feedback.message or "The result was helpful and on target.",
            "The result missed an important step.",
            "The result was unclear or incomplete.",
        ],
        "message_draft": feedback.message,
        "inferred_sentiment": feedback.kind,
        "mode": "confirmation",
    }
    return build_feedback_session_widget(session)


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
    default_value: str | None,
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
    status_text: str | None = None,
    status_icon: str | None = None,
    children: list[WidgetComponent],
) -> CardWidget:
    widget: CardWidget = {
        "type": "Card",
        "size": size,
        "children": children,
    }
    if status_text is not None:
        widget["status"] = {"text": status_text, "icon": status_icon or "check-circle"}
    if padding is not None:
        widget["padding"] = padding
    return widget


def _col_widget(
    children: list[WidgetComponent],
    *,
    gap: int | str,
    padding: int | str | None = None,
) -> ColWidget:
    widget: ColWidget = {
        "type": "Col",
        "children": children,
        "gap": gap,
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


def _tour_picker_option_label(
    scenario: TourPickerDisplayScenario,
) -> str:
    default_assets = scenario["default_asset_count"]
    return (
        f"{scenario['title']} ({default_assets} built-in default file"
        f"{'' if default_assets == 1 else 's'})"
    )


def _tour_picker_default_assets_copy(default_asset_count: int) -> str:
    suffix = "" if default_asset_count == 1 else "s"
    return f"Built-in default: {default_asset_count} file{suffix}."
