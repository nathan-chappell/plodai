from __future__ import annotations

from typing import Literal, Sequence, TypedDict

from backend.app.chatkit.metadata import AgentPlan


class WidgetStatus(TypedDict):
    text: str
    icon: str


class BadgeWidget(TypedDict):
    type: Literal["Badge"]
    label: str
    color: str
    variant: str
    pill: bool


class TitleWidget(TypedDict):
    type: Literal["Title"]
    value: str
    size: str


class CaptionWidget(TypedDict):
    type: Literal["Caption"]
    value: str
    color: str


class TextWidget(TypedDict, total=False):
    type: Literal["Text"]
    value: str
    size: str
    weight: str
    color: str


class DividerWidget(TypedDict):
    type: Literal["Divider"]


WidgetComponent = BadgeWidget | TitleWidget | CaptionWidget | TextWidget | DividerWidget


class CardWidget(TypedDict):
    type: Literal["Card"]
    size: str
    status: WidgetStatus
    children: list[WidgetComponent]


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
        _badge_widget("Tool call", color="info"),
        _title_widget(format_tool_label(tool_name), size="md"),
        _caption_widget(summary),
    ]

    clean_details = [detail.strip() for detail in details or [] if detail.strip()]
    if clean_details:
        children.append(_divider_widget())
        children.extend(_text_widget(detail) for detail in clean_details[:6])

    return _card_widget(
        size="sm",
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


def _badge_widget(
    label: str,
    *,
    color: str,
    variant: str = "soft",
    pill: bool = True,
) -> BadgeWidget:
    return {
        "type": "Badge",
        "label": label,
        "color": color,
        "variant": variant,
        "pill": pill,
    }


def _title_widget(value: str, *, size: str) -> TitleWidget:
    return {"type": "Title", "value": value, "size": size}


def _caption_widget(value: str, *, color: str = "secondary") -> CaptionWidget:
    return {"type": "Caption", "value": value, "color": color}


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


def _divider_widget() -> DividerWidget:
    return {"type": "Divider"}


def _card_widget(
    *,
    size: str,
    status_text: str,
    status_icon: str,
    children: list[WidgetComponent],
) -> CardWidget:
    return {
        "type": "Card",
        "size": size,
        "status": {"text": status_text, "icon": status_icon},
        "children": children,
    }
