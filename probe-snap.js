// Live probe: sign in with the local bootstrap admin from .env, then measure
// /api/simulator/manual-snapshot?window=0 (row count, model fill, latency).
const fs = require("fs");
const http = require("http");

function readEnvVal(key) {
    const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${key}="?([^"\\r\\n]*)"?$`, "m"));
    return m ? m[1] : "";
}

function request(method, path, body, cookie) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (cookie) { headers.Cookie = cookie; }
        if (body) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            headers["Content-Length"] = Buffer.byteLength(body);
        }
        const t0 = Date.now();
        const req = http.request({ host: "localhost", port: 3001, method, path, headers }, (res) => {
            let data = "";
            res.on("data", (c) => { data += c; });
            res.on("end", () => resolve({ status: res.statusCode, ms: Date.now() - t0, data, res }));
        });
        req.on("error", reject);
        if (body) { req.write(body); }
        req.end();
    });
}

(async () => {
    const email = readEnvVal("BOOTSTRAP_ADMIN_EMAIL");
    const password = readEnvVal("BOOTSTRAP_ADMIN_PASSWORD");
    if (!email || !password) { console.log("PROBE_FAIL no bootstrap creds in .env"); process.exit(1); }
    const login = await request("POST", "/auth/signin", new URLSearchParams({ email, password }).toString());
    const setCookie = login.res.headers["set-cookie"] || [];
    const session = setCookie.join(";").match(/optionyze_session=([^;]+)/);
    console.log(`LOGIN ${login.status} loc=${login.res.headers.location || "-"} cookie=${session ? "yes" : "no"}`);
    if (!session) { process.exit(1); }
    const cookie = `optionyze_session=${session[1]}`;

    // Candidate timestamps: ~30d, ~60d, ~90d before "now" at 12:00 UTC.
    const nowSec = Math.floor(Date.now() / 1000);
    const candidates = [30, 60, 90].map((d) => ((nowSec - d * 86400) - ((nowSec - d * 86400) % 86400)) + 43200);
    for (const ts of candidates) {
        for (const win of ["0"]) {
            const q = `/api/simulator/manual-snapshot?underlying=BTC&timestamp=${ts}&window=${win}`;
            const r = await request("GET", q, null, cookie);
            let j = null;
            try { j = JSON.parse(r.data); } catch (e) { /* not json */ }
            const iso = new Date(ts * 1000).toISOString();
            if (!j) { console.log(`T=${iso} w=${win} HTTP ${r.status} ${r.ms}ms (non-json) ${r.data.slice(0, 120)}`); continue; }
            if (j.status !== "success" || !j.data) {
                console.log(`T=${iso} w=${win} ${j.status}: ${j.message || ""}`.slice(0, 200));
                continue;
            }
            const d = j.data;
            const strikes = Array.isArray(d.strikes) ? d.strikes : [];
            const rows = strikes.reduce((n, row) => n + (row.call ? 1 : 0) + (row.put ? 1 : 0), 0);
            const strikesNoLeg = strikes.filter((s) => !s.call && !s.put).length;
            console.log(
                `T=${iso} w=${d.window} ${r.status} ${r.ms}ms | strikes=${strikes.length} legs=${rows} bare=${strikesNoLeg}` +
                ` modelCount=${d.modelCount ?? "n/a"} atm=${d.atmStrike} monthly=${d.monthlyExpiry} daily=${d.dailyExpiry}` +
                ` bytes=${r.data.length}`);
            if (d.greeksNote) { console.log(`  greeksNote: ${d.greeksNote}`.slice(0, 220)); }
            if (d.message) { console.log(`  message: ${d.message}`.slice(0, 220)); }
        }
    }
    // Sanity: window=5 still clamps on the new code path.
    const r5 = await request("GET", `/api/simulator/manual-snapshot?underlying=BTC&timestamp=${candidates[0]}&window=5`, null, cookie);
    try {
        const j5 = JSON.parse(r5.data);
        const s5 = (j5.data && j5.data.strikes) || [];
        console.log(`window=5 check: ${r5.status} ${r5.ms}ms strikes=${s5.length} windowEcho=${j5.data ? j5.data.window : "?"}`);
    } catch (e) { console.log(`window=5 check: ${r5.status} non-json`); }
})().catch((e) => { console.log("PROBE_ERROR", e.message); process.exit(1); });
