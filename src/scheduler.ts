import type { Client, MessageCreateOptions } from 'discord.js';
import { config } from './config.js';
import type { CheckerRow, PteroResourceResponse, PteroServerDetailsResponse } from './types.js';
import { getAllCheckers, getApiKeyPlain, updateCheckerState } from './db.js';
import { bytesToHuman, msToHuman } from './utils/format.js';

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

export class Scheduler {
    private client: Client;
    private timers = new Map<number, NodeJS.Timeout>();
    private running = new Set<number>();
    private nameCache = new Map<string, string>();

    constructor(client: Client) { this.client = client; }

    async bootFromDatabase() {
        const rows = await getAllCheckers();
        for (const r of rows) this.schedule(r);
    }

    upsert(row: CheckerRow) {
        this.cancel(row.id);
        this.schedule(row);
    }

    cancel(id: number) {
        const t = this.timers.get(id);
        if (t) { clearInterval(t); this.timers.delete(id); }
    }

    private schedule(row: CheckerRow) {
        const minutes = Math.max(1, row.interval_minutes || config.defaultIntervalMinutes);
        const intervalMs = minutes * 60_000;
        const tick = async () => {
            if (this.running.has(row.id)) return;
            this.running.add(row.id);
            try { await this.checkOnce(row); } finally { this.running.delete(row.id); }
        };
        delay(2_000).then(tick).catch(() => {});
        const handle = setInterval(tick, intervalMs);
        this.timers.set(row.id, handle);
    }

    private async fetchServerName(apiKey: string, supportId: string): Promise<string | null> {
        if (this.nameCache.has(supportId)) return this.nameCache.get(supportId)!;
        const url = `https://dash.icehost.pl/api/client/servers/${encodeURIComponent(supportId)}`;
        try {
            const resp = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'User-Agent': config.userAgent,
                }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json() as PteroServerDetailsResponse;
            const name = data?.attributes?.name ?? null;
            if (name) this.nameCache.set(supportId, name);
            return name;
        } catch {
            return null;
        }
    }

    private async checkOnce(row: CheckerRow) {
        const apiKey = getApiKeyPlain(row);
        const url = `https://dash.icehost.pl/api/client/servers/${encodeURIComponent(row.support_id)}/resources`;
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        let data: PteroResourceResponse | null = null;
        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'User-Agent': config.userAgent,
                },
                signal: controller.signal,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            data = await resp.json() as PteroResourceResponse;
        } catch (err) {
            if (row.last_state !== 'error') {
                await this.send(row.channel_id, {
                    content: `⚠️ Nie udało się sprawdzić stanu **${row.support_id}** (błąd sieci/API).`,
                });
                await updateCheckerState(row.id, 'error', null);
                row.last_state = 'error';
            }
            clearTimeout(to);
            return;
        }
        clearTimeout(to);

        const state = data.attributes.current_state;
        const res = data.attributes.resources;

        if (state !== row.last_state) {
            const serverName = await this.fetchServerName(apiKey, row.support_id);
            const uptime = res.uptime ?? 0;

            await this.send(row.channel_id, {
                embeds: [
                    {
                        title: `Stan serwera zmienił się: ${row.last_state ?? 'unknown'} → ${state}`,
                        description: serverName
                            ? `**Serwer:** ${serverName}\n**ID:** \`${row.support_id}\``
                            : `ID: \`${row.support_id}\``,
                        color: state === 'running' ? 0x22c55e : state === 'offline' ? 0xef4444 : 0x3b82f6,
                        fields: [
                            { name: 'CPU', value: `${res.cpu_absolute.toFixed(1)}%`, inline: true },
                            { name: 'RAM', value: bytesToHuman(res.memory_bytes), inline: true },
                            { name: 'Dysk', value: bytesToHuman(res.disk_bytes), inline: true },
                            { name: 'Sieć RX', value: bytesToHuman(res.network_rx_bytes), inline: true },
                            { name: 'Sieć TX', value: bytesToHuman(res.network_tx_bytes), inline: true },
                            { name: 'Uptime', value: msToHuman(uptime), inline: true },
                        ],
                        timestamp: new Date().toISOString(),
                    }
                ]
            });

            await updateCheckerState(row.id, state, res.uptime ?? null);
            row.last_state = state;
            row.last_uptime_ms = res.uptime ?? null;
        }
    }

    private async send(channelId: string, payload: string | MessageCreateOptions) {
        const ch = await this.client.channels.fetch(channelId).catch(() => null);
        if (!ch || !ch.isTextBased() || !ch.isSendable()) return;
        await ch.send(payload).catch(() => {});
    }
}
