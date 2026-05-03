const regex = /\b(bc1[a-zA-Z0-9]{8,90}|[13][a-zA-Z0-9]{25,34})\b/g;
console.log("The inscription is currently held by bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx.".split(regex));
