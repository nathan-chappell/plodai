from __future__ import annotations

import math
from dataclasses import dataclass, field
from hashlib import sha1
from io import BytesIO
from typing import Literal

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject
from reportlab.graphics import renderPDF
from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

from backend.app.schemas.stored_file import (
    DocumentFileSummary,
    DocumentInspectionResult,
    DocumentLocator,
    DocumentLocatorBox,
    DocumentPageSummary,
)


_DEFAULT_FONT = "Helvetica"
_DEFAULT_FONT_SIZE = 10.5
_LINE_GAP_TOLERANCE = 4.0
_PARAGRAPH_GAP_MULTIPLIER = 1.9


@dataclass(kw_only=True)
class TextFragment:
    text: str
    page_number: int
    x0: float
    y0: float
    x1: float
    y1: float
    font_size: float


@dataclass(kw_only=True)
class TextLocatorInfo:
    id: str
    page_number: int
    text: str
    bbox: tuple[float, float, float, float]
    font_size: float
    fragments: list[TextFragment] = field(default_factory=list)


@dataclass(kw_only=True)
class FormFieldInfo:
    id: str
    page_number: int
    name: str
    bbox: tuple[float, float, float, float]
    field_type: str | None = None


@dataclass(kw_only=True)
class VisualLocatorInfo:
    id: str
    page_number: int
    label: str
    bbox: tuple[float, float, float, float]
    reliability: Literal["high", "medium", "low"]


@dataclass(kw_only=True)
class SplitRange:
    title: str
    start_page: int
    end_page: int

    @property
    def page_count(self) -> int:
        return self.end_page - self.start_page + 1


@dataclass(kw_only=True)
class PdfInspectionArtifacts:
    result: DocumentInspectionResult
    text_blocks: dict[str, TextLocatorInfo]
    form_fields: dict[str, FormFieldInfo]
    visual_locators: dict[str, VisualLocatorInfo]
    page_widths: dict[int, float]
    page_heights: dict[int, float]


def inspect_pdf_document(
    *,
    file_summary: DocumentFileSummary,
    pdf_bytes: bytes,
    max_pages: int,
) -> PdfInspectionArtifacts:
    reader = PdfReader(BytesIO(pdf_bytes))
    text_blocks: dict[str, TextLocatorInfo] = {}
    form_fields: dict[str, FormFieldInfo] = {}
    visual_locators: dict[str, VisualLocatorInfo] = {}
    page_summaries: list[DocumentPageSummary] = []
    public_locators: list[DocumentLocator] = []
    page_widths: dict[int, float] = {}
    page_heights: dict[int, float] = {}

    max_page_count = min(len(reader.pages), max(1, max_pages))
    for page_index, page in enumerate(reader.pages[:max_page_count], start=1):
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)
        page_widths[page_index] = page_width
        page_heights[page_index] = page_height
        fragments = _collect_text_fragments(page, page_index)
        blocks = _group_text_blocks(fragments)
        for block in blocks:
            text_blocks[block.id] = block
            public_locators.append(
                DocumentLocator(
                    id=block.id,
                    kind="text",
                    label=_trim_label(block.text, 96),
                    page_number=block.page_number,
                    reliability="medium" if len(block.fragments) > 1 else "high",
                    bbox=_bbox_model(block.bbox),
                    text_preview=_trim_label(block.text, 180),
                )
            )

        page_summary_text = " ".join(block.text for block in blocks[:3]).strip()
        page_summaries.append(
            DocumentPageSummary(
                page_number=page_index,
                summary=_trim_label(page_summary_text or f"Page {page_index}", 220),
            )
        )

        for visual in _detect_visual_locators(blocks, page_width, page_height):
            visual_locators[visual.id] = visual
            public_locators.append(
                DocumentLocator(
                    id=visual.id,
                    kind="visual",
                    label=visual.label,
                    page_number=visual.page_number,
                    reliability=visual.reliability,
                    bbox=_bbox_model(visual.bbox),
                    text_preview=visual.label,
                )
            )

        for field in _collect_form_fields(page, page_index):
            form_fields[field.id] = field
            public_locators.append(
                DocumentLocator(
                    id=field.id,
                    kind="form_field",
                    label=field.name,
                    page_number=field.page_number,
                    reliability="high",
                    bbox=_bbox_model(field.bbox),
                    text_preview=field.name,
                )
            )

    result = DocumentInspectionResult(
        file=file_summary,
        page_count=len(reader.pages),
        locators=sorted(
            public_locators,
            key=lambda locator: (locator.page_number, locator.kind, locator.label.lower()),
        ),
        page_summaries=page_summaries,
    )
    return PdfInspectionArtifacts(
        result=result,
        text_blocks=text_blocks,
        form_fields=form_fields,
        visual_locators=visual_locators,
        page_widths=page_widths,
        page_heights=page_heights,
    )


def replace_text_in_pdf(
    *,
    pdf_bytes: bytes,
    locator: TextLocatorInfo,
    replacement_text: str,
) -> tuple[bytes | None, Literal["direct_replace", "overlay_replace"] | None, str | None]:
    cleaned_replacement = replacement_text.strip()
    if not cleaned_replacement:
        return (None, None, "Replacement text must be non-empty.")

    direct_bytes = _try_direct_replace(pdf_bytes, locator, cleaned_replacement)
    if direct_bytes is not None:
        return (direct_bytes, "direct_replace", None)

    overlay_bytes = _try_overlay_replace(pdf_bytes, locator, cleaned_replacement)
    if overlay_bytes is not None:
        return (
            overlay_bytes,
            "overlay_replace",
            "Applied a safe overlay replacement because direct content-stream replacement was not reliable.",
        )

    return (
        None,
        None,
        "The replacement text could not be safely applied within the located region.",
    )


def fill_form_fields_in_pdf(
    *,
    pdf_bytes: bytes,
    field_values: dict[str, str],
) -> bytes:
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    field_map = {name: value for name, value in field_values.items() if name.strip()}
    for page in writer.pages:
        writer.update_page_form_field_values(page, field_map)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def replace_visual_region(
    *,
    pdf_bytes: bytes,
    locator: VisualLocatorInfo,
    title: str,
    rows: list[dict[str, object]],
    render_as: Literal["table", "chart"],
) -> bytes:
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    page_index = locator.page_number - 1
    page = writer.pages[page_index]
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    overlay = _build_visual_overlay_pdf(
        page_width=page_width,
        page_height=page_height,
        bbox=locator.bbox,
        rows=rows,
        title=title,
        render_as=render_as,
    )
    overlay_reader = PdfReader(BytesIO(overlay))
    page.merge_page(overlay_reader.pages[0])
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def append_pdf_bytes(
    *,
    base_pdf_bytes: bytes,
    appendix_pdf_bytes: bytes,
) -> bytes:
    writer = PdfWriter(clone_from=PdfReader(BytesIO(base_pdf_bytes)))
    appendix_reader = PdfReader(BytesIO(appendix_pdf_bytes))
    for appendix_page in appendix_reader.pages:
        writer.add_page(appendix_page)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def build_dataset_appendix_pdf(
    *,
    title: str,
    rows: list[dict[str, object]],
    render_as: Literal["table", "chart"],
) -> bytes:
    buffer = BytesIO()
    document = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    _draw_dataset_visual(
        document,
        x=36,
        y=72,
        width=width - 72,
        height=height - 144,
        title=title,
        rows=rows,
        render_as=render_as,
    )
    document.save()
    return buffer.getvalue()


def plan_smart_split(
    *,
    inspection: PdfInspectionArtifacts,
) -> list[SplitRange]:
    page_count = inspection.result.page_count
    if page_count <= 3:
        return [SplitRange(title="Document", start_page=1, end_page=page_count)]

    heading_candidates: list[SplitRange] = []
    by_page: dict[int, list[TextLocatorInfo]] = {}
    for block in inspection.text_blocks.values():
        by_page.setdefault(block.page_number, []).append(block)

    sorted_pages = sorted(by_page)
    current_start = 1
    current_title = "Opening"
    for page_number in sorted_pages[1:]:
        first_block = sorted(
            by_page.get(page_number, []),
            key=lambda block: (-block.bbox[3], block.bbox[0]),
        )[:1]
        if not first_block:
            continue
        candidate = first_block[0]
        if _looks_like_heading(candidate.text):
            heading_candidates.append(
                SplitRange(
                    title=current_title,
                    start_page=current_start,
                    end_page=page_number - 1,
                )
            )
            current_start = page_number
            current_title = _trim_label(candidate.text, 72)

    if heading_candidates:
        heading_candidates.append(
            SplitRange(
                title=current_title,
                start_page=current_start,
                end_page=page_count,
            )
        )
        cleaned = [entry for entry in heading_candidates if entry.page_count >= 1]
        if len(cleaned) >= 2:
            return cleaned

    chunk_size = 5 if page_count > 10 else max(2, math.ceil(page_count / 2))
    return [
        SplitRange(
            title=f"Part {index + 1}",
            start_page=start_page,
            end_page=min(page_count, start_page + chunk_size - 1),
        )
        for index, start_page in enumerate(range(1, page_count + 1, chunk_size))
    ]


def extract_page_range_pdf(
    *,
    pdf_bytes: bytes,
    start_page: int,
    end_page: int,
) -> bytes:
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page_number in range(start_page - 1, end_page):
        writer.add_page(reader.pages[page_number])
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _collect_text_fragments(page, page_number: int) -> list[TextFragment]:
    fragments: list[TextFragment] = []

    def _visit_text(text, _cm, tm, _font_dict, font_size):
        if not isinstance(text, str):
            return
        cleaned = " ".join(text.replace("\x00", "").split())
        if not cleaned:
            return
        x0 = float(tm[4] or 0.0)
        y0 = float(tm[5] or 0.0)
        resolved_font_size = float(font_size or _DEFAULT_FONT_SIZE)
        width = max(
            stringWidth(cleaned, _DEFAULT_FONT, resolved_font_size),
            resolved_font_size * max(len(cleaned), 1) * 0.35,
        )
        fragments.append(
            TextFragment(
                text=cleaned,
                page_number=page_number,
                x0=x0,
                y0=y0,
                x1=x0 + width,
                y1=y0 + resolved_font_size,
                font_size=resolved_font_size,
            )
        )

    page.extract_text(visitor_text=_visit_text)
    return sorted(fragments, key=lambda fragment: (-fragment.y0, fragment.x0))


def _group_text_blocks(fragments: list[TextFragment]) -> list[TextLocatorInfo]:
    if not fragments:
        return []

    lines: list[list[TextFragment]] = []
    for fragment in fragments:
        if not lines or abs(lines[-1][0].y0 - fragment.y0) > _LINE_GAP_TOLERANCE:
            lines.append([fragment])
            continue
        lines[-1].append(fragment)

    sorted_lines = [sorted(line, key=lambda fragment: fragment.x0) for line in lines]
    blocks: list[list[TextFragment]] = []
    for line in sorted_lines:
        if not blocks:
            blocks.append(list(line))
            continue
        previous_line_y = max(fragment.y0 for fragment in blocks[-1][-len(line) :])
        line_y = max(fragment.y0 for fragment in line)
        average_size = sum(fragment.font_size for fragment in line) / max(len(line), 1)
        if previous_line_y - line_y <= average_size * _PARAGRAPH_GAP_MULTIPLIER:
            blocks[-1].extend(line)
        else:
            blocks.append(list(line))

    text_blocks: list[TextLocatorInfo] = []
    for block_index, block_fragments in enumerate(blocks, start=1):
        text = _join_block_text(block_fragments)
        if not text:
            continue
        x0 = min(fragment.x0 for fragment in block_fragments)
        y0 = min(fragment.y0 for fragment in block_fragments) - 2.0
        x1 = max(fragment.x1 for fragment in block_fragments)
        y1 = max(fragment.y1 for fragment in block_fragments) + 2.0
        page_number = block_fragments[0].page_number
        font_size = (
            sum(fragment.font_size for fragment in block_fragments)
            / max(len(block_fragments), 1)
        )
        locator_id = _stable_locator_id(
            "text",
            page_number,
            text,
            block_index,
            (x0, y0, x1, y1),
        )
        text_blocks.append(
            TextLocatorInfo(
                id=locator_id,
                page_number=page_number,
                text=text,
                bbox=(x0, y0, x1, y1),
                font_size=font_size,
                fragments=block_fragments,
            )
        )
    return text_blocks


def _collect_form_fields(page, page_number: int) -> list[FormFieldInfo]:
    annotations = page.get("/Annots")
    if annotations is None:
        return []
    fields: list[FormFieldInfo] = []
    for annotation_ref in annotations:
        try:
            annotation = annotation_ref.get_object()
        except Exception:
            continue
        if str(annotation.get("/Subtype")) != "/Widget":
            continue
        field_name = annotation.get("/T")
        if not isinstance(field_name, str) or not field_name.strip():
            continue
        rect = annotation.get("/Rect") or [0, 0, 0, 0]
        bbox = (
            float(rect[0]),
            float(rect[1]),
            float(rect[2]),
            float(rect[3]),
        )
        field_id = _stable_locator_id("form", page_number, field_name, 0, bbox)
        fields.append(
            FormFieldInfo(
                id=field_id,
                page_number=page_number,
                name=field_name.strip(),
                bbox=bbox,
                field_type=str(annotation.get("/FT")) if annotation.get("/FT") else None,
            )
        )
    return fields


def _detect_visual_locators(
    blocks: list[TextLocatorInfo],
    page_width: float,
    page_height: float,
) -> list[VisualLocatorInfo]:
    visual_locators: list[VisualLocatorInfo] = []
    for block_index, block in enumerate(blocks, start=1):
        text_lower = block.text.lower()
        reliability: Literal["high", "medium", "low"] | None = None
        label = _trim_label(block.text, 80)
        if any(token in text_lower for token in ("figure", "chart", "graph")):
            reliability = "medium"
        elif "table" in text_lower:
            reliability = "medium"
        elif sum(character.isdigit() for character in block.text) >= max(6, len(block.text) // 5):
            reliability = "low"
            label = f"Numeric region: {label}"
        if reliability is None:
            continue

        x0 = max(24.0, min(block.bbox[0] - 6.0, page_width - 72.0))
        x1 = min(page_width - 24.0, max(block.bbox[2] + 180.0, page_width - 24.0))
        y0 = max(24.0, block.bbox[1] - 160.0)
        y1 = min(page_height - 24.0, block.bbox[3] + 18.0)
        if y1 <= y0:
            continue
        locator_id = _stable_locator_id(
            "visual",
            block.page_number,
            label,
            block_index,
            (x0, y0, x1, y1),
        )
        visual_locators.append(
            VisualLocatorInfo(
                id=locator_id,
                page_number=block.page_number,
                label=label,
                bbox=(x0, y0, x1, y1),
                reliability=reliability,
            )
        )
    return visual_locators


def _try_direct_replace(
    pdf_bytes: bytes,
    locator: TextLocatorInfo,
    replacement_text: str,
) -> bytes | None:
    if len(locator.fragments) != 1:
        return None
    original_text = locator.fragments[0].text
    if (
        not original_text
        or any(ord(character) > 126 for character in original_text)
        or any(ord(character) > 126 for character in replacement_text)
    ):
        return None
    font_size = max(locator.font_size, 8.0)
    available_width = locator.bbox[2] - locator.bbox[0]
    if stringWidth(replacement_text, _DEFAULT_FONT, font_size) > available_width + 4:
        return None

    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    page = writer.pages[locator.page_number - 1]
    contents = page.get_contents()
    if contents is None:
        return None
    try:
        current_data = contents.get_data()
    except Exception:
        return None
    original_bytes = original_text.encode("latin-1", errors="ignore")
    replacement_bytes = replacement_text.encode("latin-1", errors="ignore")
    if not original_bytes or current_data.count(original_bytes) != 1:
        return None
    next_data = current_data.replace(original_bytes, replacement_bytes, 1)
    updated_stream = DecodedStreamObject()
    updated_stream.set_data(next_data)
    page[NameObject("/Contents")] = updated_stream
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _try_overlay_replace(
    pdf_bytes: bytes,
    locator: TextLocatorInfo,
    replacement_text: str,
) -> bytes | None:
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    page = writer.pages[locator.page_number - 1]
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    x0, y0, x1, y1 = locator.bbox
    font_size = min(max(locator.font_size, 9.0), 14.0)
    desired_width = stringWidth(replacement_text, _DEFAULT_FONT, font_size) + 12.0
    max_width = max(48.0, page_width - x0 - 36.0)
    box_width = min(max_width, max(24.0, x1 - x0, desired_width))
    box_height = max(24.0, (y1 - y0) + font_size)
    wrapped_lines = simpleSplit(
        replacement_text,
        _DEFAULT_FONT,
        font_size,
        box_width - 8.0,
    )
    line_height = font_size * 1.25
    required_height = len(wrapped_lines) * line_height + 8.0
    if required_height > box_height + 2.0:
        return None

    overlay_buffer = BytesIO()
    overlay_canvas = canvas.Canvas(overlay_buffer, pagesize=(page_width, page_height))
    overlay_canvas.setFillColor(colors.white)
    overlay_canvas.rect(x0 - 2.0, y0 - 2.0, box_width + 4.0, box_height + 4.0, fill=1, stroke=0)
    overlay_canvas.setFillColor(colors.black)
    overlay_canvas.setFont(_DEFAULT_FONT, font_size)
    text_cursor = overlay_canvas.beginText(x0 + 2.0, y1 - font_size)
    for line in wrapped_lines:
        text_cursor.textLine(line)
    overlay_canvas.drawText(text_cursor)
    overlay_canvas.save()

    overlay_reader = PdfReader(BytesIO(overlay_buffer.getvalue()))
    page.merge_page(overlay_reader.pages[0])
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _build_visual_overlay_pdf(
    *,
    page_width: float,
    page_height: float,
    bbox: tuple[float, float, float, float],
    rows: list[dict[str, object]],
    title: str,
    render_as: Literal["table", "chart"],
) -> bytes:
    buffer = BytesIO()
    document = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    x0, y0, x1, y1 = bbox
    document.setFillColor(colors.white)
    document.rect(x0 - 2.0, y0 - 2.0, (x1 - x0) + 4.0, (y1 - y0) + 4.0, fill=1, stroke=0)
    _draw_dataset_visual(
        document,
        x=x0,
        y=y0,
        width=max(48.0, x1 - x0),
        height=max(48.0, y1 - y0),
        title=title,
        rows=rows,
        render_as=render_as,
    )
    document.save()
    return buffer.getvalue()


def _draw_dataset_visual(
    document: canvas.Canvas,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    rows: list[dict[str, object]],
    render_as: Literal["table", "chart"],
) -> None:
    document.setFillColor(HexColor("#111827"))
    document.setFont("Helvetica-Bold", 11)
    document.drawString(x, y + height - 14, _trim_label(title or "Updated visual", 84))

    if render_as == "chart":
        chart_drawing = _build_bar_chart(rows, width=width, height=height - 26, title=title)
        if chart_drawing is not None:
            renderPDF.draw(chart_drawing, document, x, y + 8)
            return

    table_data = _tabular_preview(rows)
    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#1f2937")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("BACKGROUND", (0, 1), (-1, -1), HexColor("#f9fafb")),
                ("GRID", (0, 0), (-1, -1), 0.25, HexColor("#d1d5db")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HexColor("#f3f4f6")]),
            ]
        )
    )
    table_width = max(48.0, width)
    table_height = max(32.0, height - 24.0)
    wrapped_width, wrapped_height = table.wrap(table_width, table_height)
    draw_y = max(y + 8.0, y + table_height - wrapped_height)
    table.drawOn(document, x, draw_y)


def _build_bar_chart(
    rows: list[dict[str, object]],
    *,
    width: float,
    height: float,
    title: str,
) -> Drawing | None:
    del title
    if not rows:
        return None
    label_key = next(iter(rows[0].keys()), None)
    numeric_keys = [
        key
        for key in rows[0].keys()
        if all(isinstance(row.get(key), int | float) for row in rows[:8])
    ]
    if label_key is None or not numeric_keys:
        return None
    value_key = numeric_keys[0]
    labels = [str(row.get(label_key, ""))[:20] for row in rows[:8]]
    values = [float(row.get(value_key, 0.0) or 0.0) for row in rows[:8]]
    if not values:
        return None

    drawing = Drawing(width, max(120.0, height))
    chart = VerticalBarChart()
    chart.x = 24
    chart.y = 24
    chart.width = max(120.0, width - 48)
    chart.height = max(64.0, height - 64)
    chart.data = [values]
    chart.strokeColor = HexColor("#4b5563")
    chart.valueAxis.strokeColor = HexColor("#6b7280")
    chart.valueAxis.valueMin = 0
    chart.valueAxis.valueMax = max(values) * 1.15 if max(values) > 0 else 1
    chart.valueAxis.valueStep = max(1, math.ceil(chart.valueAxis.valueMax / 4))
    chart.categoryAxis.categoryNames = labels
    chart.categoryAxis.labels.angle = 25
    chart.categoryAxis.labels.dy = -10
    chart.bars[0].fillColor = HexColor("#2563eb")
    drawing.add(chart)
    drawing.add(String(24, height - 10, f"{label_key} vs {value_key}", fontSize=10))
    return drawing


def _tabular_preview(rows: list[dict[str, object]]) -> list[list[str]]:
    if not rows:
        return [["No data"], ["Dataset was empty."]]
    columns = list(rows[0].keys())[:6]
    data: list[list[str]] = [columns]
    for row in rows[:14]:
        data.append([_cell_text(row.get(column)) for column in columns])
    return data


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.3f}".rstrip("0").rstrip(".")
    return str(value)[:64]


def _join_block_text(block_fragments: list[TextFragment]) -> str:
    if not block_fragments:
        return ""
    sorted_fragments = sorted(block_fragments, key=lambda fragment: (-fragment.y0, fragment.x0))
    chunks: list[str] = []
    current_y = None
    current_line: list[str] = []
    for fragment in sorted_fragments:
        if current_y is None or abs(current_y - fragment.y0) <= _LINE_GAP_TOLERANCE:
            current_line.append(fragment.text)
            current_y = fragment.y0 if current_y is None else current_y
            continue
        chunks.append(" ".join(current_line))
        current_line = [fragment.text]
        current_y = fragment.y0
    if current_line:
        chunks.append(" ".join(current_line))
    return "\n".join(chunk.strip() for chunk in chunks if chunk.strip()).strip()


def _stable_locator_id(
    prefix: str,
    page_number: int,
    text: str,
    index: int,
    bbox: tuple[float, float, float, float],
) -> str:
    digest = sha1(
        (
            f"{prefix}|{page_number}|{index}|{round(bbox[0], 1)}|{round(bbox[1], 1)}|"
            f"{round(bbox[2], 1)}|{round(bbox[3], 1)}|{text.strip()}"
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _bbox_model(bbox: tuple[float, float, float, float]) -> DocumentLocatorBox:
    return DocumentLocatorBox(
        x0=round(float(bbox[0]), 2),
        y0=round(float(bbox[1]), 2),
        x1=round(float(bbox[2]), 2),
        y1=round(float(bbox[3]), 2),
    )


def _looks_like_heading(text: str) -> bool:
    cleaned = " ".join(text.split())
    if not cleaned:
        return False
    word_count = len(cleaned.split())
    if word_count > 10:
        return False
    return cleaned.istitle() or cleaned.isupper() or cleaned.lower().startswith("section ")


def _trim_label(value: str, limit: int) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) <= limit:
        return cleaned
    return f"{cleaned[: max(0, limit - 1)].rstrip()}..."
