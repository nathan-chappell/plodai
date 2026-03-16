export const BLOG_INDEX_PATH = "/blog";

type BlogMetadata = {
  title?: string;
  summary?: string;
  publishedAt?: string;
  slug?: string;
  tags?: string[];
  underConstruction?: boolean;
};

export type BlogPost = {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  publishedLabel: string | null;
  markdown: string;
  directoryName: string;
  readingTimeMinutes: number;
  tags: string[];
  underConstruction: boolean;
};

export type BlogViewerRole = "admin" | "user" | null;

const articleModules = import.meta.glob("../../../blog/*/article.md", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const metadataModules = import.meta.glob("../../../blog/*/metadata.json", {
  eager: true,
  import: "default",
}) as Record<string, BlogMetadata>;

function extractDirectoryName(path: string): string | null {
  const match = path.match(/\/blog\/([^/]+)\/[^/]+$/);
  return match?.[1] ?? null;
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function deriveTitle(markdown: string, directoryName: string): string {
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }

  const withoutDatePrefix = directoryName.replace(/^\d{2}-\d{2}-\d{4}-/, "");
  return toTitleCase(withoutDatePrefix || directoryName);
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveSummary(markdown: string): string | null {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("#") && !part.startsWith("- ") && !part.startsWith("* "));

  for (const paragraph of paragraphs) {
    const summary = stripMarkdown(paragraph);
    if (summary.length >= 60) {
      return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}...` : summary;
    }
  }

  return null;
}

function derivePublishedAt(directoryName: string, metadata?: BlogMetadata): string | null {
  if (metadata?.publishedAt) {
    return metadata.publishedAt;
  }

  const match = directoryName.match(/^(\d{2})-(\d{2})-(\d{4})(?:-|$)/);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function formatPublishedLabel(publishedAt: string | null): string | null {
  if (!publishedAt) {
    return null;
  }

  const parsed = new Date(`${publishedAt}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return publishedAt;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function estimateReadingTime(markdown: string): number {
  const words = stripMarkdown(markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function normalizeSlug(directoryName: string, metadata?: BlogMetadata): string {
  return (metadata?.slug ?? directoryName).trim().replace(/^\/+|\/+$/g, "");
}

function normalizeTags(metadata?: BlogMetadata): string[] {
  return Array.isArray(metadata?.tags)
    ? metadata.tags.map((tag) => tag.trim()).filter(Boolean)
    : [];
}

function comparePosts(left: BlogPost, right: BlogPost): number {
  if (left.publishedAt && right.publishedAt && left.publishedAt !== right.publishedAt) {
    return right.publishedAt.localeCompare(left.publishedAt);
  }

  if (left.publishedAt && !right.publishedAt) {
    return -1;
  }

  if (!left.publishedAt && right.publishedAt) {
    return 1;
  }

  return left.slug.localeCompare(right.slug);
}

const blogPosts: BlogPost[] = Object.entries(articleModules)
  .map(([path, markdown]) => {
    const directoryName = extractDirectoryName(path);
    if (!directoryName) {
      return null;
    }

    const metadataPath = path.replace(/article\.md$/, "metadata.json");
    const metadata = metadataModules[metadataPath];
    const publishedAt = derivePublishedAt(directoryName, metadata);

    return {
      slug: normalizeSlug(directoryName, metadata),
      title: metadata?.title?.trim() || deriveTitle(markdown, directoryName),
      summary: metadata?.summary?.trim() || deriveSummary(markdown),
      publishedAt,
      publishedLabel: formatPublishedLabel(publishedAt),
      markdown,
      directoryName,
      readingTimeMinutes: estimateReadingTime(markdown),
      tags: normalizeTags(metadata),
      underConstruction: metadata?.underConstruction === true,
    } satisfies BlogPost;
  })
  .filter((post): post is BlogPost => post !== null)
  .sort(comparePosts);

export function listBlogPosts(): BlogPost[] {
  return blogPosts;
}

export function getBlogPost(slug: string): BlogPost | null {
  return blogPosts.find((post) => post.slug === slug) ?? null;
}

export function canViewBlogPost(post: BlogPost, viewerRole: BlogViewerRole): boolean {
  return !post.underConstruction || viewerRole === "admin";
}

export function isBlogPath(pathname: string): boolean {
  return pathname === BLOG_INDEX_PATH || pathname.startsWith(`${BLOG_INDEX_PATH}/`);
}

export function getBlogPostPath(slug: string): string {
  return `${BLOG_INDEX_PATH}/${slug}`;
}
