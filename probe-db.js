// Read-only: list account flags from the local Postgres DB (no secrets printed).
const fs = require("fs");
const { Client } = require("pg");

(async () => {
    const m = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\r\n]+)"?$/m);
    if (!m) { console.log("NO_DATABASE_URL"); return; }
    const client = new Client({ connectionString: m[1] });
    await client.connect();
    const r = await client.query("SELECT email, is_active, is_admin, must_change_password, created_at FROM accounts ORDER BY created_at");
    for (const row of r.rows) {
        console.log(`${row.email} active=${row.is_active} admin=${row.is_admin} mustChange=${row.must_change_password} created=${String(row.created_at).slice(0, 19)}`);
    }
    if (!r.rows.length) { console.log("ACCOUNTS_TABLE_EMPTY"); }
    await client.end();
})().catch((e) => { console.log("DB_ERR", e.message); process.exit(1); });
