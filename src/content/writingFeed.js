const FEED_URL = "./public/content/substack-posts.json";
const SOURCE_URL = "https://daoooyi.substack.com/feed";

export function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function validateWritingFeed(data) {
  if (data?.version !== 1 || data.source !== SOURCE_URL || !Array.isArray(data.posts) || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw new Error("Invalid writing snapshot");
  }
  const seen = new Set();
  const posts = data.posts.flatMap((post) => {
    if (typeof post?.title !== "string" || !post.title.trim()) return [];
    let url;
    try { url = new URL(post.url); } catch { return []; }
    if (url.protocol !== "https:" || url.hostname !== "daoooyi.substack.com" || url.port || !url.pathname.startsWith("/p/") || url.username || url.password || seen.has(url.href)) return [];
    seen.add(url.href);
    return [{ title: Array.from(post.title.trim()).slice(0, 280).join(""), url: url.href, publishedAt: Number.isFinite(Date.parse(post.publishedAt)) ? new Date(post.publishedAt).toISOString() : null, summary: typeof post.summary === "string" ? Array.from(post.summary.replace(/\s+/g, " ").trim()).slice(0, 160).join("") : "" }];
  }).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 5);
  if (data.posts.length && !posts.length) throw new Error("No valid public writing links");
  return { updatedAt: new Date(data.updatedAt).toISOString(), posts };
}

export async function loadWritingFeed({ signal, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(FEED_URL, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Writing snapshot unavailable");
  return validateWritingFeed(await response.json());
}

export function writingFeedTemplate(feed, { refreshing = false, failed = false } = {}) {
  if (!feed) return `<p class="writing-feed-status" role="status">${failed ? "Posts are unavailable right now. Visit Substack below." : "Loading posts…"}</p>`;
  const date = new Date(feed.updatedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  const status = failed ? `Could not refresh. Showing the saved snapshot from ${date}.` : refreshing ? "Updating posts…" : `Last checked ${date}`;
  const posts = feed.posts.map((post) => `<li><a href="${escapeText(post.url)}" target="_blank" rel="noopener noreferrer">${escapeText(post.title)}</a>${post.publishedAt ? `<time datetime="${escapeText(post.publishedAt)}">${escapeText(new Date(post.publishedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }))}</time>` : ""}${post.summary ? `<p class="writing-post-summary">${escapeText(post.summary)}</p>` : ""}</li>`).join("");
  return `${posts ? `<ul class="writing-posts">${posts}</ul>` : "<p class=\"writing-empty\">No public posts yet. Visit Substack below.</p>"}<p class="writing-feed-status" role="status">${escapeText(status)}</p>`;
}
