import ReactMarkdown from "react-markdown";
import styled from "styled-components";

import { type BlogPost, type BlogViewerRole, canViewBlogPost, getBlogPost, getBlogPostPath, listBlogPosts, BLOG_INDEX_PATH } from "../lib/blog";
import { navigate } from "../lib/router";

const posts = listBlogPosts();
const externalArticles = [
  {
    title: "Intro to ChatGPT",
    href: "https://mono.software/2024/05/23/intro-to-chatgpt/",
    meta: "Mono Software · May 23, 2024",
    summary:
      "A practical primer on why ChatGPT changed NLP work: generative models reframed text tasks, lowered the barrier for builders, and made AI experimentation much more approachable for software teams.",
  },
  {
    title: "Case Study: AI-enabled Virtual Assistants",
    href: "https://mono.software/2024/07/17/virtual-assistants-case-study/",
    meta: "Mono Software · July 17, 2024",
    summary:
      "A grounded case study on building a property-management assistant with LLMs, including entity extraction, retrieval, routing decisions, and the tradeoff of keeping humans in the loop when full automation gets brittle.",
  },
] as const;

const BlogShell = styled.main`
  min-height: 100vh;
  padding: clamp(1.25rem, 3vw, 2rem);
`;

const BlogLayout = styled.div`
  width: min(1180px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 1.25rem;
`;

const BlogTopbar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: rgba(255, 252, 247, 0.72);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);

  @media (max-width: 720px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const BrandBlock = styled.div`
  display: grid;
  gap: 0.2rem;
`;

const Eyebrow = styled.div`
  font-size: 0.74rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-deep);
`;

const BrandTitle = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: clamp(1.3rem, 2vw, 1.75rem);
  text-align: left;
  cursor: pointer;
`;

const BrandMeta = styled.p`
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${({ $primary }) => ($primary ? "transparent" : "var(--line)")};
  padding: 0.72rem 1rem;
  border-radius: 999px;
  background: ${({ $primary }) => ($primary ? "var(--ink)" : "rgba(255, 255, 255, 0.55)")};
  color: ${({ $primary }) => ($primary ? "white" : "var(--ink)")};
  cursor: pointer;
  transition: transform 180ms ease, background 180ms ease;

  &:hover {
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    transform: none;
    opacity: 0.56;
  }
`;

const PostGrid = styled.section`
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 1rem;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const FeaturedCard = styled.article`
  grid-column: span 7;
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: rgba(255, 253, 249, 0.9);
  box-shadow: var(--shadow);

  @media (max-width: 920px) {
    grid-column: auto;
  }
`;

const AsideColumn = styled.div`
  grid-column: span 5;
  display: grid;
  gap: 1rem;

  @media (max-width: 920px) {
    grid-column: auto;
  }
`;

const PostCard = styled.article`
  display: grid;
  gap: 0.8rem;
  padding: 1.2rem;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: rgba(255, 251, 246, 0.86);
  box-shadow: var(--shadow);
`;

const PostMeta = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.55rem 0.75rem;
  color: var(--muted);
  font-size: 0.82rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const PostTitleButton = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--ink);
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 3vw, 2.4rem);
  line-height: 1;
  text-align: left;
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.72;
  }
`;

const PostExcerpt = styled.p`
  margin: 0;
  color: var(--muted);
  line-height: 1.75;
`;

const TagRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
`;

const TagChip = styled.span<{ $tone?: "default" | "warning" }>`
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.6rem;
  border-radius: 999px;
  border: 1px solid
    ${({ $tone }) => ($tone === "warning" ? "rgba(201, 111, 59, 0.35)" : "var(--line)")};
  background: ${({ $tone }) => ($tone === "warning" ? "rgba(201, 111, 59, 0.12)" : "rgba(255, 255, 255, 0.62)")};
  color: ${({ $tone }) => ($tone === "warning" ? "var(--accent-deep)" : "var(--muted)")};
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const DisabledCardBody = styled.div`
  display: grid;
  gap: 0.7rem;
`;

const DisabledNote = styled.p`
  margin: 0;
  color: var(--accent-deep);
  line-height: 1.65;
`;

const EmptyCard = styled.section`
  padding: 2rem;
  border: 1px dashed var(--line);
  border-radius: 28px;
  background: rgba(255, 251, 246, 0.75);
  color: var(--muted);
`;

const ExternalSection = styled.section`
  display: grid;
  gap: 0.85rem;
  padding: 1rem 1.1rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: rgba(255, 251, 246, 0.82);
  box-shadow: var(--shadow);
`;

const SectionHeading = styled.div`
  display: grid;
  gap: 0.25rem;
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.35rem, 2.5vw, 1.85rem);
  line-height: 1.02;
`;

const SectionMeta = styled.p`
  margin: 0;
  max-width: 64ch;
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.65;
`;

const ExternalGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const ExternalCard = styled.a`
  display: grid;
  gap: 0.75rem;
  padding: 1.1rem 1.15rem;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.68);
  color: inherit;
  text-decoration: none;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease;

  &:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--accent) 32%, var(--line));
    background: rgba(255, 255, 255, 0.84);
  }
`;

const ExternalTitle = styled.h3`
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.35rem;
  line-height: 1.08;
`;

const ExternalMeta = styled.div`
  color: var(--accent-deep);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const ExternalSummary = styled.p`
  margin: 0;
  color: var(--muted);
  line-height: 1.75;
`;

const ExternalCta = styled.span`
  color: var(--ink);
  font-weight: 700;
`;

const ArticleShell = styled.article`
  width: min(860px, 100%);
  margin: 0 auto;
  padding: clamp(1.4rem, 4vw, 2.5rem);
  border: 1px solid var(--line);
  border-radius: 32px;
  background: rgba(255, 253, 249, 0.93);
  box-shadow: var(--shadow);
`;

const ArticleHeader = styled.header`
  display: grid;
  gap: 1rem;
  margin-bottom: 2rem;
`;

const BackButton = styled.button`
  width: fit-content;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent-deep);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
`;

const ArticleTitle = styled.h1`
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.4rem, 8vw, 4.8rem);
  line-height: 0.96;
`;

const ArticleSummary = styled.p`
  margin: 0;
  color: var(--muted);
  font-size: 1.04rem;
  line-height: 1.8;
`;

const ArticleNotice = styled.div`
  display: grid;
  gap: 0.65rem;
  padding: 1rem 1.05rem;
  border: 1px solid rgba(201, 111, 59, 0.3);
  border-radius: 20px;
  background: rgba(201, 111, 59, 0.08);
`;

const MarkdownBody = styled.div`
  color: var(--ink);
  font-size: 1.02rem;
  line-height: 1.9;

  h1,
  h2,
  h3,
  h4 {
    margin: 2.3rem 0 0.9rem;
    font-family: var(--font-display);
    line-height: 1.08;
  }

  h1 {
    font-size: 2.4rem;
  }

  h2 {
    font-size: 1.8rem;
  }

  h3 {
    font-size: 1.35rem;
  }

  p,
  ul,
  ol,
  blockquote {
    margin: 0 0 1.1rem;
  }

  ul,
  ol {
    padding-left: 1.35rem;
  }

  li + li {
    margin-top: 0.45rem;
  }

  a {
    color: var(--accent-deep);
  }

  code {
    padding: 0.14rem 0.34rem;
    border-radius: 8px;
    background: rgba(31, 41, 55, 0.08);
    font-size: 0.94em;
  }

  pre {
    overflow-x: auto;
    padding: 1rem;
    border-radius: 18px;
    background: rgba(31, 41, 55, 0.94);
    color: #f8fafc;
  }

  pre code {
    padding: 0;
    background: transparent;
    color: inherit;
  }

  blockquote {
    padding: 0.2rem 0 0.2rem 1rem;
    border-left: 3px solid var(--accent);
    color: var(--muted);
  }
`;

function routeTo(path: string) {
  navigate(path);
  window.scrollTo({ top: 0 });
}

function ArticleMeta({
  publishedLabel,
  readingTimeMinutes,
  underConstruction = false,
}: {
  publishedLabel: string | null;
  readingTimeMinutes: number;
  underConstruction?: boolean;
}) {
  return (
    <PostMeta>
      {publishedLabel ? <span>{publishedLabel}</span> : <span>Draft</span>}
      <span>{readingTimeMinutes} min read</span>
      {underConstruction ? <span>Under construction</span> : null}
    </PostMeta>
  );
}

function BlogTags({ post }: { post: BlogPost }) {
  if (!post.tags.length && !post.underConstruction) {
    return null;
  }

  return (
    <TagRow>
      {post.underConstruction ? <TagChip $tone="warning">Under construction</TagChip> : null}
      {post.tags.map((tag) => (
        <TagChip key={tag}>{tag}</TagChip>
      ))}
    </TagRow>
  );
}

function BlogCard({ post, viewerRole, featured = false }: { post: BlogPost; viewerRole: BlogViewerRole; featured?: boolean }) {
  const canView = canViewBlogPost(post, viewerRole);
  const Card = featured ? FeaturedCard : PostCard;

  return (
    <Card>
      <ArticleMeta
        publishedLabel={post.publishedLabel}
        readingTimeMinutes={post.readingTimeMinutes}
        underConstruction={post.underConstruction}
      />
      <PostTitleButton
        disabled={!canView}
        onClick={canView ? () => routeTo(getBlogPostPath(post.slug)) : undefined}
        type="button"
      >
        {post.title}
      </PostTitleButton>
      <BlogTags post={post} />
      {post.summary ? <PostExcerpt>{post.summary}</PostExcerpt> : null}
      {canView ? (
        featured ? (
          <ActionRow>
            <ActionButton $primary onClick={() => routeTo(getBlogPostPath(post.slug))} type="button">
              Read article
            </ActionButton>
          </ActionRow>
        ) : null
      ) : (
        <DisabledCardBody>
          <DisabledNote>This article is still being assembled. Admins can preview it, but everyone else gets the sealed crate for now.</DisabledNote>
          {featured ? (
            <ActionRow>
              <ActionButton disabled type="button">
                Under construction
              </ActionButton>
            </ActionRow>
          ) : null}
        </DisabledCardBody>
      )}
    </Card>
  );
}

function BlogIndex({ viewerRole }: { viewerRole: BlogViewerRole }) {
  const [featuredPost, ...otherPosts] = posts;

  return (
    <>
      <ExternalSection>
        <SectionHeading>
          <Eyebrow>External links</Eyebrow>
          <SectionTitle>Related writing from elsewhere</SectionTitle>
          <SectionMeta>
            A couple of older AI posts worth keeping nearby while this in-repo blog grows up.
          </SectionMeta>
        </SectionHeading>
        <ExternalGrid>
          {externalArticles.map((article) => (
            <ExternalCard href={article.href} key={article.href} rel="noreferrer" target="_blank">
              <ExternalMeta>{article.meta}</ExternalMeta>
              <ExternalTitle>{article.title}</ExternalTitle>
              <ExternalSummary>{article.summary}</ExternalSummary>
              <ExternalCta>Open article</ExternalCta>
            </ExternalCard>
          ))}
        </ExternalGrid>
      </ExternalSection>

      {!featuredPost ? (
        <EmptyCard>No posts yet. Add `blog/your-post/article.md` and this page will populate on the next build.</EmptyCard>
      ) : (
        <PostGrid>
          <BlogCard featured post={featuredPost} viewerRole={viewerRole} />

          <AsideColumn>
            {otherPosts.map((post) => (
              <BlogCard key={post.slug} post={post} viewerRole={viewerRole} />
            ))}
          </AsideColumn>
        </PostGrid>
      )}
    </>
  );
}

function BlogArticle({ slug, viewerRole }: { slug: string; viewerRole: BlogViewerRole }) {
  const post = getBlogPost(slug);

  if (!post) {
    return (
      <ArticleShell>
        <ArticleHeader>
          <BackButton onClick={() => routeTo(BLOG_INDEX_PATH)} type="button">
            Back to blog
          </BackButton>
          <ArticleTitle>Article not found</ArticleTitle>
          <ArticleSummary>That post does not exist yet, or its folder name and slug no longer match.</ArticleSummary>
        </ArticleHeader>
      </ArticleShell>
    );
  }

  if (!canViewBlogPost(post, viewerRole)) {
    return (
      <ArticleShell>
        <ArticleHeader>
          <BackButton onClick={() => routeTo(BLOG_INDEX_PATH)} type="button">
            Back to blog
          </BackButton>
          <ArticleMeta
            publishedLabel={post.publishedLabel}
            readingTimeMinutes={post.readingTimeMinutes}
            underConstruction={post.underConstruction}
          />
          <ArticleTitle>{post.title}</ArticleTitle>
          <BlogTags post={post} />
          <ArticleNotice>
            <ArticleSummary>
              This article is under construction. Admins can preview the working draft, but it is not published for general readers yet.
            </ArticleSummary>
          </ArticleNotice>
        </ArticleHeader>
      </ArticleShell>
    );
  }

  return (
    <ArticleShell>
      <ArticleHeader>
        <BackButton onClick={() => routeTo(BLOG_INDEX_PATH)} type="button">
          Back to blog
        </BackButton>
        <ArticleMeta
          publishedLabel={post.publishedLabel}
          readingTimeMinutes={post.readingTimeMinutes}
          underConstruction={post.underConstruction}
        />
        <ArticleTitle>{post.title}</ArticleTitle>
        <BlogTags post={post} />
        {post.summary ? <ArticleSummary>{post.summary}</ArticleSummary> : null}
      </ArticleHeader>
      <MarkdownBody>
        <ReactMarkdown>{post.markdown}</ReactMarkdown>
      </MarkdownBody>
    </ArticleShell>
  );
}

export function BlogPage({ pathname, viewerRole }: { pathname: string; viewerRole: BlogViewerRole }) {
  const slug = pathname.startsWith(`${BLOG_INDEX_PATH}/`)
    ? decodeURIComponent(pathname.slice(BLOG_INDEX_PATH.length + 1)).replace(/\/+$/g, "")
    : null;

  return (
    <BlogShell>
      <BlogLayout>
        <BlogTopbar>
          <BrandBlock>
            <Eyebrow>AI Portfolio</Eyebrow>
            <BrandTitle onClick={() => routeTo(BLOG_INDEX_PATH)} type="button">
              Blog
            </BrandTitle>
            <BrandMeta>Markdown posts with optional metadata, tags, and admin-only draft previews.</BrandMeta>
          </BrandBlock>
          <ActionRow>
            <ActionButton onClick={() => routeTo(BLOG_INDEX_PATH)} type="button">
              All posts
            </ActionButton>
          </ActionRow>
        </BlogTopbar>

        {slug ? <BlogArticle slug={slug} viewerRole={viewerRole} /> : <BlogIndex viewerRole={viewerRole} />}
      </BlogLayout>
    </BlogShell>
  );
}
