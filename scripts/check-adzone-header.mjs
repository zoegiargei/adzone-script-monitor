#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "config", "adzone.sites.json");
const STATE_DIR = path.join(ROOT, "state");

const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 12000);

async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}

async function readJson(p, fallback = null) {
    try {
        return JSON.parse(await fs.readFile(p, "utf8"));
    } catch {
        return fallback;
    }
}

async function writeJson(p, data) {
    await fs.writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function parseGoogHashHeader(value) {
    const out = { md5: null, crc32c: null };
    if (!value) return out;

    const parts = String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    for (const p of parts) {
        const m = p.match(/^(crc32c|md5)=(.+)$/i);
        if (!m) continue;
        out[m[1].toLowerCase()] = m[2];
    }

    return out;
}

async function fetchGoogMd5(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method: "HEAD",
            signal: ctrl.signal,
            headers: {
                "cache-control": "no-cache",
                pragma: "no-cache"
            }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const xGoogHash = res.headers.get("x-goog-hash");
        const { md5 } = parseGoogHashHeader(xGoogHash);

        return md5;
    } finally {
        clearTimeout(t);
    }
}

// ALERTA "solo código" mínima: imprimir por stdout/stderr
// (Luego lo enchufás a Slack webhook o email)
function alert(msg) {
    console.error(msg);
}

async function main() {
    await ensureDir(STATE_DIR);
    const sites = JSON.parse(await fs.readFile(CFG_PATH, "utf8"));
    const runAt = new Date().toISOString();

    for (const [site, url] of Object.entries(sites)) {
        const statePath = path.join(STATE_DIR, `${site}.md5.json`);
        const prev = await readJson(statePath, null);

        let md5;
        try {
            md5 = await fetchGoogMd5(url);
        } catch (e) {
            alert(`[AdZoneGuard][${site}] ERROR fetch HEAD x-goog-hash: ${String(e)} url=${url}`);
            continue;
        }

        const next = {
            site,
            url,
            checkedAt: runAt,
            md5
        };

        if (!md5) {
            alert(`[AdZoneGuard][${site}] WARNING no md5 found in x-goog-hash header url=${url}`);
        }

        // baseline
        if (!prev) {
            await writeJson(statePath, next);
            console.log(`[AdZoneGuard][${site}] reference state saved md5=${md5 || "n/a"}`);
            continue;
        }

        const changed = prev.md5 !== next.md5;

        if (changed) {
            alert(
                `[AdZoneGuard][${site}] CHANGE DETECTED\n` +
                `url=${url}\n` +
                `prevMd5=${prev.md5 || "n/a"}\n` +
                `nextMd5=${next.md5 || "n/a"}\n` +
                `checkedAt=${runAt}`
            );
        } else {
            console.log(`[AdZoneGuard][${site}] no change md5=${md5 || "n/a"}`);
        }

        await writeJson(statePath, next);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
