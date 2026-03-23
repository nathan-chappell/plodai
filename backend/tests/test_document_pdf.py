from io import BytesIO

from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from backend.app.schemas.stored_file import DocumentFileSummary, EmptyStoredFilePreview
from backend.app.services.document_pdf import (
    fill_form_fields_in_pdf,
    inspect_pdf_document,
    plan_smart_split,
    replace_text_in_pdf,
)


def _document_summary(name: str) -> DocumentFileSummary:
    return DocumentFileSummary(
        id="file_document",
        openai_file_id="file-openai",
        scope="document_thread_file",
        source_kind="upload",
        app_id="documents",
        workspace_id="workspace_documents",
        thread_id="thread_documents",
        attachment_id=None,
        parent_file_id=None,
        name=name,
        kind="pdf",
        extension="pdf",
        mime_type="application/pdf",
        byte_size=0,
        status="available",
        preview=EmptyStoredFilePreview(),
        expires_at=None,
        created_at="2026-03-23T00:00:00+00:00",
        updated_at="2026-03-23T00:00:00+00:00",
    )


def _build_text_pdf() -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.setFont("Helvetica", 12)
    pdf.drawString(72, 720, "Original paragraph for testing.")
    pdf.showPage()
    pdf.drawString(72, 720, "Section Overview")
    pdf.showPage()
    pdf.drawString(72, 720, "Financial Summary")
    pdf.save()
    return buffer.getvalue()


def _build_form_pdf() -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.drawString(72, 740, "Customer Name")
    pdf.acroForm.textfield(
        name="customer_name",
        x=72,
        y=700,
        width=240,
        height=24,
        borderStyle="solid",
    )
    pdf.save()
    return buffer.getvalue()


def test_inspect_pdf_document_returns_text_locators() -> None:
    pdf_bytes = _build_text_pdf()
    inspection = inspect_pdf_document(
        file_summary=_document_summary("sample.pdf"),
        pdf_bytes=pdf_bytes,
        max_pages=5,
    )

    assert inspection.result.page_count == 3
    assert any(locator.kind == "text" for locator in inspection.result.locators)
    assert any("Original paragraph" in (locator.text_preview or "") for locator in inspection.result.locators)


def test_replace_text_in_pdf_creates_updated_text() -> None:
    pdf_bytes = _build_text_pdf()
    inspection = inspect_pdf_document(
        file_summary=_document_summary("sample.pdf"),
        pdf_bytes=pdf_bytes,
        max_pages=5,
    )
    locator = next(
        block
        for block in inspection.text_blocks.values()
        if "Original paragraph for testing." in block.text
    )

    updated_bytes, strategy, warning = replace_text_in_pdf(
        pdf_bytes=pdf_bytes,
        locator=locator,
        replacement_text="Updated paragraph for testing.",
    )

    assert updated_bytes is not None
    assert strategy in {"direct_replace", "overlay_replace"}
    updated_text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(updated_bytes)).pages)
    assert "Updated paragraph for testing." in updated_text
    if strategy == "overlay_replace":
        assert warning is not None


def test_fill_form_fields_in_pdf_updates_acroform_values() -> None:
    pdf_bytes = _build_form_pdf()
    inspection = inspect_pdf_document(
        file_summary=_document_summary("form.pdf"),
        pdf_bytes=pdf_bytes,
        max_pages=3,
    )
    locator = next(iter(inspection.form_fields.values()))

    updated_bytes = fill_form_fields_in_pdf(
        pdf_bytes=pdf_bytes,
        field_values={locator.name: "Acme Farms"},
    )

    fields = PdfReader(BytesIO(updated_bytes)).get_fields()
    assert fields is not None
    assert fields["customer_name"].value == "Acme Farms"


def test_plan_smart_split_produces_ranges() -> None:
    pdf_bytes = _build_text_pdf()
    inspection = inspect_pdf_document(
        file_summary=_document_summary("split.pdf"),
        pdf_bytes=pdf_bytes,
        max_pages=5,
    )

    ranges = plan_smart_split(inspection=inspection)

    assert ranges
    assert ranges[0].start_page == 1
    assert ranges[-1].end_page == inspection.result.page_count
