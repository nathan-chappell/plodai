export const WRITING_INDEX_PATH = "/writing";
export const LEGACY_BLOG_INDEX_PATH = "/blog";

export type WritingLinkEntry = {
  id: string;
  title: string;
  url?: string;
  platform: "Mono" | "LinkedIn" | "Draft";
  publishedAt?: string;
  summary: string;
  draftSourcePath?: string;
};

const writingEntries: WritingLinkEntry[] = [
  {
    id: "mono-intro-chatgpt",
    title: "Intro to ChatGPT",
    url: "https://mono.software/2024/05/23/intro-to-chatgpt/",
    platform: "Mono",
    publishedAt: "2024-05-23",
    summary:
      "A practical primer on why ChatGPT changed NLP work: generative models reframed text tasks, lowered the barrier for builders, and made experimentation much more approachable for software teams.",
  },
  {
    id: "mono-virtual-assistants",
    title: "Case Study: AI-enabled Virtual Assistants",
    url: "https://mono.software/2024/07/17/virtual-assistants-case-study/",
    platform: "Mono",
    publishedAt: "2024-07-17",
    summary:
      "A grounded case study on building a property-management assistant with LLMs, including extraction, retrieval, routing, and the tradeoffs of keeping humans in the loop.",
  },
  {
    id: "draft-theoretical-justification",
    title: "The Theoretical Justification of Neural Networks",
    platform: "Draft",
    summary:
      "A draft essay on why neural networks have the expressive and approximation properties that make them practical, with supporting artifacts evolving alongside the writeup.",
    draftSourcePath: "blog/15-03-2026-the-theoretical-justification-of-neural-networks",
  },
  {
    id: "draft-ai-and-the-old-gods",
    title: "AI and the Old Gods",
    platform: "Draft",
    summary:
      "An unpublished essay draft exploring AI, mythic framing, and the emotional texture around modern tooling and identity.",
    draftSourcePath: "blog/15-03-2026-ai-and-the-old-gods",
  },
];

function compareEntries(left: WritingLinkEntry, right: WritingLinkEntry): number {
  if (left.publishedAt && right.publishedAt && left.publishedAt !== right.publishedAt) {
    return right.publishedAt.localeCompare(left.publishedAt);
  }
  if (left.publishedAt && !right.publishedAt) {
    return -1;
  }
  if (!left.publishedAt && right.publishedAt) {
    return 1;
  }
  return left.title.localeCompare(right.title);
}

export function listPublishedWritingEntries(): WritingLinkEntry[] {
  return writingEntries.filter((entry) => Boolean(entry.url)).sort(compareEntries);
}

export function formatWritingDate(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

export function isWritingPath(pathname: string): boolean {
  return pathname === WRITING_INDEX_PATH;
}

export function isLegacyBlogPath(pathname: string): boolean {
  return pathname === LEGACY_BLOG_INDEX_PATH || pathname.startsWith(`${LEGACY_BLOG_INDEX_PATH}/`);
}
