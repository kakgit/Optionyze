// Smoke test: renders the Simulator view with mock locals to verify the EJS
// template and its partials compile. Run with: node scripts/smoke-render-simulator.js
const path = require("node:path");
const ejs = require("ejs");

const viewPath = path.resolve(process.cwd(), "src", "views", "simulator.ejs");

ejs.renderFile(viewPath, {
    pageTitle: "Simulator | Optionyze",
    currentAccount: {
        accountId: "acc-smoke",
        fullName: "Smoke Tester",
        email: "smoke@example.com",
        isAdmin: false
    },
    defaultUserId: "acc-smoke",
    simulatorResolutions: ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d", "1w"],
    simulatorMaxCandles: 16000,
    simulatorRowsPerCall: 4001
}).then((html) => {
    const checks = [
        ["nav link", html.includes('href="/simulator"')],
        ["price chart canvas", html.includes('id="simPriceChart"')],
        ["legs table", html.includes('id="simLegsBody"')],
        ["pnl canvas", html.includes('id="simPnlChart"')],
        ["resolution options", html.includes('value="1w"')],
        ["script tag", html.includes("/js/simulator.js")]
    ];
    const arrFailed = checks.filter(([, ok]) => !ok);
    if (arrFailed.length) {
        console.error("SMOKE_FAIL missing:", arrFailed.map(([name]) => name).join(", "));
        process.exit(1);
    }
    console.log(`SMOKE_OK rendered ${html.length} chars`);
}).catch((objError) => {
    console.error("SMOKE_ERR", objError);
    process.exit(1);
});
