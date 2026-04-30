function normalizeXMentionUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase();
    if (hostname !== "x.com" && hostname !== "twitter.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 3 || parts[1] !== "status" || !/^\d+$/.test(parts[2])) {
      return null;
    }
    const normalized = new URL(`https://x.com/${parts[0]}/status/${parts[2]}`);
    return normalized.toString();
  } catch {
    return null;
  }
}

function normalizePublicXReferenceUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.replace(/^www\./i, "").replace(/^mobile\./i, "").toLowerCase();
    if (hostname !== "twstalker.com" && !hostname.endsWith(".twstalker.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanHtmlText(value) {
  return collapseWhitespace(
    decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
  );
}

function dedupeXMentions(mentions) {
  const seen = new Set();
  return mentions.filter((mention) => {
    const normalizedUrl = normalizeXMentionUrl(mention.url) ?? normalizePublicXReferenceUrl(mention.url);
    if (!normalizedUrl || seen.has(normalizedUrl)) return false;
    seen.add(normalizedUrl);
    mention.url = normalizedUrl;
    mention.title = collapseWhitespace(mention.title);
    mention.snippet = collapseWhitespace(mention.snippet);
    return true;
  });
}

function parseBraveResults(html, foundAt) {
  const mentions = [];
  const resultPattern = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(resultPattern)) {
    const href = decodeHtmlEntities(match[1] ?? "");
    const realUrl = normalizeXMentionUrl(href) ?? normalizePublicXReferenceUrl(href);
    if (!realUrl) continue;
    const title = cleanHtmlText(match[2] ?? "");
    const snippet = title;
    mentions.push({ url: realUrl, title, snippet, found_at: foundAt });
  }
  return dedupeXMentions(mentions);
}

const mockHtml = `
<html>
<body>
  <div class="snippet">
    <a href="https://x.com/BitcoinPuppets/status/1862871285321146837">
      Bitcoin Puppets on X: "The puppets are taking over..."
    </a>
  </div>
  <div class="snippet">
    <a href="https://twitter.com/CryptoInfluencer/status/1234567890">
      CryptoInfluencer: "Just bought my first Bitcoin Puppet! #ordinals"
    </a>
  </div>
</body>
</html>
`;
const results = parseBraveResults(mockHtml, new Date().toISOString());
console.log("Mock Parsing Results:");
console.log(JSON.stringify(results, null, 2));
