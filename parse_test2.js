const meta = "jattributesevaluedNonejtrait_typejAttributesevalueiDark Greyjtrait_typejBackgroundevalueePeppyjtrait_typedFaceevaluekYellow Phatjtrait_typedHatsevaluehKeyboardjtrait_typedItemevalueiShed Lifejtrait_typeeShirtdnametBitcoin Puppet #2971";

const traits = [];
const parts = meta.split("trait_type");
for(let i=1; i<parts.length; i++) {
   const part = parts[i];
   const traitLen = part.charCodeAt(0) - 96;
   const traitName = part.substring(1, 1 + traitLen);
   
   const valIdx = part.indexOf("value");
   if(valIdx !== -1) {
       const valLen = part.charCodeAt(valIdx + 5) - 96;
       const valStr = part.substring(valIdx + 6, valIdx + 6 + valLen);
       traits.push({ trait_type: traitName, value: valStr });
   }
}
console.log(JSON.stringify(traits, null, 2));
