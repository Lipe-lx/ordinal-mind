import { formatChronicleText } from "./src/app/lib/formatters";
const React = require("react");

const str = "The inscription is currently held by bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx.";
console.log(JSON.stringify(formatChronicleText(str), null, 2));
