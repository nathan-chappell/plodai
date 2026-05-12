import type {
  AdvisoryMaterial,
  AdvisoryMeasurement,
  AdvisoryRecordPayload,
  AdvisoryReport,
  AdvisorySubject,
} from "../types/advisory";

export const UNNAMED_ADVISORY_CASE_LABEL = "New advisory case";

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function humanizeToken(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  const humanized = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

export function getAdvisoryCaseDisplayTitle(value: string | null | undefined): string {
  return normalizeOptionalText(value) ?? UNNAMED_ADVISORY_CASE_LABEL;
}

function normalizeSubject(subject: AdvisorySubject): AdvisorySubject {
  return {
    ...subject,
    type: humanizeToken(subject.type),
    location: normalizeOptionalText(subject.location),
    description: normalizeOptionalText(subject.description),
    quantity: normalizeOptionalText(subject.quantity),
    status: subject.status ?? null,
    notes: normalizeOptionalText(subject.notes),
  };
}

function normalizeReport(report: AdvisoryReport): AdvisoryReport {
  return {
    ...report,
    description: normalizeOptionalText(report.description),
    status: report.status ?? null,
    severity: report.severity ?? null,
    reported_at: normalizeOptionalText(report.reported_at),
    observed_at: normalizeOptionalText(report.observed_at),
    location: normalizeOptionalText(report.location),
    recommended_follow_up: normalizeOptionalText(report.recommended_follow_up),
    subject_ids: report.subject_ids ?? [],
    evidence_image_ids: report.evidence_image_ids ?? [],
    measurement_ids: report.measurement_ids ?? [],
  };
}

function normalizeMeasurement(measurement: AdvisoryMeasurement): AdvisoryMeasurement {
  return {
    ...measurement,
    unit: normalizeOptionalText(measurement.unit),
    measured_at: normalizeOptionalText(measurement.measured_at),
    method: normalizeOptionalText(measurement.method),
    location: normalizeOptionalText(measurement.location),
    subject_ids: measurement.subject_ids ?? [],
    report_ids: measurement.report_ids ?? [],
    query_ids: measurement.query_ids ?? [],
    notes: normalizeOptionalText(measurement.notes),
  };
}

function normalizeMaterial(material: AdvisoryMaterial): AdvisoryMaterial {
  return {
    ...material,
    purpose: normalizeOptionalText(material.purpose),
    category: humanizeToken(material.category),
    supplier_name: normalizeOptionalText(material.supplier_name),
    supplier_url: normalizeOptionalText(material.supplier_url),
    subject_ids: material.subject_ids ?? [],
    report_ids: material.report_ids ?? [],
    query_ids: material.query_ids ?? [],
    notes: normalizeOptionalText(material.notes),
  };
}

export function normalizeAdvisoryPayload(record: AdvisoryRecordPayload): AdvisoryRecordPayload {
  return {
    ...record,
    title: getAdvisoryCaseDisplayTitle(record.title),
    profile_description: normalizeOptionalText(record.profile_description),
    default_location: normalizeOptionalText(record.default_location),
    subjects: (record.subjects ?? []).map(normalizeSubject),
    reports: (record.reports ?? []).map(normalizeReport),
    queries: record.queries ?? [],
    measurements: (record.measurements ?? []).map(normalizeMeasurement),
    materials: (record.materials ?? []).map(normalizeMaterial),
  };
}

export function getNamesForIds(
  ids: readonly string[],
  namesById: ReadonlyMap<string, string>,
): string[] {
  return ids
    .map((id) => namesById.get(id)?.trim() ?? "")
    .filter((value) => value.length > 0);
}
