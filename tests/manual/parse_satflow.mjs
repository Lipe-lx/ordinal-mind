import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, 'satflow_test.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const match = html.match(/\\"rarityRank\\":\d+/g);
console.log("Rarity Ranks found:", match);

const match2 = html.match(/\\"attributes\\":\[.*?\]/g);
if (match2) {
  console.log("Attributes found:", match2.slice(0, 3));
}
