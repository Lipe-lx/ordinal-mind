import fs from 'fs';
const html = fs.readFileSync('satflow_test.html', 'utf-8');

const match = html.match(/\\"rarityRank\\":\d+/g);
console.log("Rarity Ranks found:", match);

const match2 = html.match(/\\"attributes\\":\[.*?\]/g);
if (match2) {
  console.log("Attributes found:", match2.slice(0, 3));
}
