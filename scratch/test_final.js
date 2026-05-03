function processRegex(parts, regex, renderMatch) {
  const newParts = [];
  let matchIndex = 0;
  parts.forEach((part) => {
    if (typeof part !== "string") {
      newParts.push(part);
      return;
    }
    const split = part.split(regex);
    split.forEach((s, i) => {
      if (i % 2 === 1) {
        if (s !== undefined) {
          newParts.push(`[MATCH:${s}]`);
        }
      } else if (s !== "") {
        newParts.push(s);
      }
    });
  });
  return newParts;
}

const text = "Tent Life #5 (ID: 9ac52f51c594f4c72940217eacbced7fa61d04b0d7a9715aac16d3cd4bb37d19i1) is a webp image inscribed on December 20, 2025";
const onChainIdRegex = /((?:bc1|tb1)\S{20,120}|[13][a-zA-Z0-9]{25,45}|[a-fA-F0-9]{32,}\s*[a-fA-F0-9]{32,}i\d+)/gi;
const inscriptionRegex = /(#\s*\d+(?:[.,]\d+)*|\b[Ii]nscription \d+(?:[.,]\d+)*\b)/g;

let parts = [text];
parts = processRegex(parts, onChainIdRegex, (m) => m);
parts = processRegex(parts, inscriptionRegex, (m) => m);
console.log(parts);
