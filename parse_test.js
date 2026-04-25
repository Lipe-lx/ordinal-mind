const meta = "jattributesevaluedNonejtrait_typejAttributesevalueiDark Greyjtrait_typejBackgroundevalueePeppyjtrait_typedFaceevaluekYellow Phatjtrait_typedHatsevaluehKeyboardjtrait_typedItemevalueiShed Lifejtrait_typeeShirtdnametBitcoin Puppet #2971";

const parts = meta.split('trait_type');
const traits = [];
for (let i = 1; i < parts.length; i++) {
  const part = parts[i];
  if (!part) continue;
  const traitNameLenChar = part[0];
  const traitNameLen = traitNameLenChar.charCodeAt(0) - 96;
  if (traitNameLen > 0 && traitNameLen < part.length) {
    const traitName = part.substring(1, 1 + traitNameLen);
    const valueIdx = part.indexOf('value', 1 + traitNameLen);
    if (valueIdx !== -1) {
      const valLenChar = part[valueIdx + 5];
      if (valLenChar) {
        const valLen = valLenChar.charCodeAt(0) - 96;
        if (valLen > 0 && valueIdx + 6 + valLen <= part.length) {
          const valueStr = part.substring(valueIdx + 6, valueIdx + 6 + valLen);
          if (traitName !== "Attributes") {
            traits.push({ trait_type: traitName, value: valueStr });
          }
        }
      }
    }
  }
}
console.log(traits);
