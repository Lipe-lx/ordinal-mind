const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function testDDG(query) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  console.log(`Fetching ${url}...`);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) {
    console.error(`HTTP Error: ${res.status}`);
    return;
  }

  const html = await res.text();
  console.log(`HTML Length: ${html.length}`);
  
  // Minimal manual parsing to verify structure
  const results = [];
  const links = html.match(/class=['"]result-link['"].*?href=['"](.*?)['"]>(.*?)<\/a>/g);
  console.log(`Found ${links?.length || 0} links`);
  
  if (links) {
    links.slice(0, 3).forEach(link => {
       const m = link.match(/class=['"]result-link['"].*?href=['"](.*?)['"]>(.*?)<\/a>/);
       console.log(`- Result: ${m[2]} (${m[1]})`);
    });
  }
}

testDDG("Bitcoin Puppets Ordinals lore");
