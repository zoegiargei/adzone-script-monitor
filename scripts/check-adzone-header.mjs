#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, "config", "adzone.sites.json");
const STATE_DIR = path.join(ROOT, "state");

const MAX_BYTES = Number(process.env.MAX_BYTES || 2048); // header a leer
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

async function fetchHeaderSample(url, maxBytes) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                // Pedimos solo el comienzo del archivo
                range: `bytes=0-${maxBytes - 1}`,
                "cache-control": "no-cache",
                pragma: "no-cache"
            }
        });

        // Ojo: algunos servers ignoran Range y devuelven 200 con todo.
        // Igual nos quedamos con el comienzo y ya.
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
        return text.slice(0, maxBytes);
    } finally {
        clearTimeout(t);
    }
}

function parseVersionAndDate(sampleText) {
    // Busca en el header cosas tipo:
    // // v 255
    // // 2026-Jan-14 09:53:31
    const versionMatch = sampleText.match(/\/\/\s*v\s*(\d+)/i);
    const dateMatch = sampleText.match(
        /\/\/\s*(\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2})/
    );

    return {
        version: versionMatch?.[1] || null,
        date: dateMatch?.[1] || null
    };
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
        const statePath = path.join(STATE_DIR, `${site}.header.json`);
        const prev = await readJson(statePath, null);

        let sample;
        try {
            sample = await fetchHeaderSample(url, MAX_BYTES);
        } catch (e) {
            alert(`[AdZoneGuard][${site}] ERROR fetch header: ${String(e)} url=${url}`);
            continue;
        }

        const { version, date } = parseVersionAndDate(sample);

        const next = {
            site,
            url,
            checkedAt: runAt,
            version,
            date
        };

        // Si no parseó nada, también es señal (cambió formato o no está)
        if (!version && !date) {
            alert(
                `[AdZoneGuard][${site}] WARNING no version/date found in header (format changed?) url=${url}`
            );
        }

        // baseline
        if (!prev) {
            await writeJson(statePath, next);
            console.log(`[AdZoneGuard][${site}] baseline saved v=${version} date=${date}`);
            continue;
        }

        const changed = prev.version !== next.version || prev.date !== next.date;

        if (changed) {
            alert(
                `[AdZoneGuard][${site}] CHANGE DETECTED\n` +
                `url=${url}\n` +
                `prev: v=${prev.version} date=${prev.date}\n` +
                `next: v=${next.version} date=${next.date}\n` +
                `checkedAt=${runAt}`
            );
        } else {
            console.log(`[AdZoneGuard][${site}] no change v=${version} date=${date}`);
        }

        await writeJson(statePath, next);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
