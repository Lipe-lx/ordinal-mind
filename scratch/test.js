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
          newParts.push(renderMatch(s, matchIndex++));
        }
      } else if (s !== "") {
        newParts.push(s);
      }
    });
  });
  return newParts;
}

let parts = ["The inscription is currently held by bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx."];
const addressRegex = /(bc1[a-zA-Z0-9]{8,90}|[13][a-zA-Z0-9]{25,34})/g;
parts = processRegex(parts, addressRegex, (match) => `[ADDR:${match.slice(0,4)}...${match.slice(-4)}]`);
console.log(parts);
