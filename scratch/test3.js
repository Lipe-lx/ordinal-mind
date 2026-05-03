const parts = ["The inscription is currently held by bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx."];
const addressRegex = /(bc1[a-zA-Z0-9]{20,100}|[13][a-zA-Z0-9]{25,34})/g;
let newParts = [];
let matchIndex = 0;
parts.forEach(part => {
  const split = part.split(addressRegex);
  split.forEach((s, i) => {
    if (i % 2 === 1) {
      if (s !== undefined) {
        newParts.push(`[ADDR:${s.slice(0,4)}...${s.slice(-4)}]`);
      }
    } else if (s !== "") {
      newParts.push(s);
    }
  });
});
console.log(newParts);
