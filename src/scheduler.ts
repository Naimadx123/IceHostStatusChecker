import type { Client, MessageCreateOptions } from 'discord.js';
import { config } from './config.js';
import type { CheckerRow, PteroResourceResponse, PteroServerDetailsResponse } from './types.js';
import { getAllCheckers, getApiKeyPlain, updateCheckerState } from './db.js';
import { bytesToHuman, msToHuman } from './utils/format.js';

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

type JsonHeaders = Record<string, string>;

export class Scheduler {
  private client: Client;
  private timers = new Map<number, NodeJS.Timeout>();
  private running = new Set<number>();
  private nameCache = new Map<string, string>();
  private failCounts = new Map<number, number>();

  private readonly maxRetries = 3;
  private readonly baseBackoffMs = 500;

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

  private async httpGetJson<T>(url: string, headers: JsonHeaders, timeoutMs: number): Promise<T> {
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(to);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json() as T;
      } catch (err) {
        lastErr = err;
        clearTimeout(to);

        if (attempt < this.maxRetries - 1) {
          const backoff = this.baseBackoffMs * (attempt + 1);
          const jitter = Math.floor(Math.random() * 150);
          await delay(backoff + jitter);
        }
      }
    }

    throw lastErr ?? new Error('Request failed');
  }

  private async fetchServerName(apiKey: string, supportId: string): Promise<string | null> {
    if (this.nameCache.has(supportId)) return this.nameCache.get(supportId)!;
    const url = `https://dash.icehost.pl/api/client/servers/${encodeURIComponent(supportId)}`;
    try {
      const data = await this.httpGetJson<PteroServerDetailsResponse>(url, {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': config.userAgent,
      }, config.requestTimeoutMs);
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

    let data: PteroResourceResponse | null = null;
    try {
      data = await this.httpGetJson<PteroResourceResponse>(url, {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': config.userAgent,
      }, config.requestTimeoutMs);
    } catch (err) {
      const fails = (this.failCounts.get(row.id) ?? 0) + 1;
      this.failCounts.set(row.id, fails);

      console.log(err);

      if (fails >= this.maxRetries && row.last_state !== 'error') {
        await this.send(row.channel_id, {
          content: `⚠️ Nie udało się sprawdzić stanu **${row.support_id}** (błąd sieci/API, ${fails}×).`,
        });
        await updateCheckerState(row.id, 'error', null);
        row.last_state = 'error';
      }
      return;
    }

    const prevFails = this.failCounts.get(row.id) ?? 0;
    if (prevFails > 0) {
      this.failCounts.set(row.id, 0);
      // if (row.last_state === 'error') {
      //   await this.send(row.channel_id, { content: `✅ Połączenie z API przywrócone dla **${row.support_id}**.` });
      // }
    }

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
    if (!ch || !ch.isTextBased() || !('send' in ch)) return;
    await ch.send(payload).catch(() => {});
  }
}
