const regex = /((?:bc1|tb1)[a-zA-Z0-9]{20,100}|[13][a-zA-Z0-9]{25,34})/gi;
console.log("The inscription is currently held by bc1pqeuysaz8dfwd0479gpgk0nvuwnka52xhu8c6efn3vzcdfjhkrccsvrewnx.".split(regex));
