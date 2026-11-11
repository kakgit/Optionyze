const fs = require("fs");
const src = "D:\\NodeJS\\Optionyze\\public\\js\\rolling-futures-lt.js";
const dst = "D:\\NodeJS\\Optionyze\\public\\js\\crypto-scalper.js";

let content = fs.readFileSync(src, "utf8");

// Crypto Scalper-specific settings (mirrors the original crypto-scalper.js header).
const subs = [
    ['const strategyLabel = String(document.body?.dataset?.rollingFuturesStrategyLabel || "").trim() || "Covered Options";',
     'const strategyLabel = String(document.body?.dataset?.rollingFuturesStrategyLabel || "").trim() || "Crypto Scalper";'],
    ['const endpointBase = endpointBaseOverride || (mode === "short"\n        ? "/api/rollingfutures-lt-short"\n        : (mode === "covered" ? "/api/covered-options" : "/api/rollingfutures-lt-long"));',
     'const endpointBase = endpointBaseOverride || (mode === "short"\n        ? "/api/rollingfutures-lt-short"\n        : (mode === "covered" ? "/api/crypto-scalper" : "/api/rollingfutures-lt-long"));'],
];

let applied = 0;
for (const [from, to] of subs) {
    if (content.includes(from)) { content = content.replace(from, to); applied++; }
    else { console.log("WARN: substitution not found:", from.slice(0, 60)); }
}
console.log("Substitutions applied:", applied, "of", subs.length);

fs.writeFileSync(dst, content, "utf8");
console.log("Rebuilt crypto-scalper.js. Size:", content.length);