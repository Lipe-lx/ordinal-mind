const fs = require('fs');
const html = fs.readFileSync('satflow_test.html', 'utf-8');

// The JSON might be embedded in a script tag as self.__next_f.push
// Or directly as a JS object.
// Let's just regex match the inscription data block.
const match = html.match(/"rarityRank":\d+/g);
console.log("Rarity Ranks found:", match);

const match2 = html.match(/"attributes":\[.*?\]/g);
if (match2) {
  console.log("Attributes found:", match2.slice(0, 3));
}
