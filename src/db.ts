import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { config } from './config.js';
import type { CheckerRow } from './types.js';

const key = (() => {
    const raw = config.encryptionKeyBase64;
    const parts = raw.startsWith('base64:') ? raw.slice(7) : raw;
    const buf = Buffer.from(parts, 'base64');
    if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes base64');
    return buf;
})();

function encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(enc: string): string {
    const buf = Buffer.from(enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
}

export const pool = mysql.createPool({
    ...config.mysql,
    timezone: 'Z',
    connectionLimit: 10,
    namedPlaceholders: true,
});

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS checkers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            guild_id VARCHAR(32) NOT NULL,
            channel_id VARCHAR(32) NOT NULL,
            support_id VARCHAR(64) NOT NULL,
            api_key_enc TEXT NOT NULL,
            interval_minutes INT NOT NULL DEFAULT 5,
            last_state VARCHAR(32) NULL,
            last_uptime_ms BIGINT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_guild_support (guild_id, support_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
}

export async function getChecker(guildId: string, supportId: string): Promise<CheckerRow | null> {
    const [rows] = await pool.query<mysql.RowDataPacket[] & CheckerRow[]>(
        'SELECT * FROM checkers WHERE guild_id = :guild_id AND support_id = :support_id',
        { guild_id: guildId, support_id: supportId }
    );
    return (rows[0] as CheckerRow) ?? null;
}

export async function getAllCheckers(): Promise<CheckerRow[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[] & CheckerRow[]>('SELECT * FROM checkers');
    return rows as CheckerRow[];
}

export async function getCheckersBySupportId(supportId: string): Promise<CheckerRow[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[] & CheckerRow[]>(
        'SELECT * FROM checkers WHERE support_id = :support_id',
        { support_id: supportId }
    );
    return rows as CheckerRow[];
}

export function getApiKeyPlain(row: CheckerRow): string {
    return decrypt(row.api_key_enc);
}

export async function upsertChecker(params: {
    guildId: string;
    channelId: string;
    supportId: string;
    apiKeyPlain: string;
    intervalMinutes: number;
}): Promise<CheckerRow> {
    const api_key_enc = encrypt(params.apiKeyPlain);
    await pool.query(
        `INSERT INTO checkers (guild_id, channel_id, support_id, api_key_enc, interval_minutes)
             VALUES (:guild_id, :channel_id, :support_id, :api_key_enc, :interval_minutes)
                 ON DUPLICATE KEY UPDATE
                  channel_id = VALUES(channel_id),
                  api_key_enc = VALUES(api_key_enc)`,
        {
            guild_id: params.guildId,
            channel_id: params.channelId,
            support_id: params.supportId,
            api_key_enc,
            interval_minutes: params.intervalMinutes,
        }
    );
    const [rows] = await pool.query<mysql.RowDataPacket[] & CheckerRow[]>(
        'SELECT * FROM checkers WHERE guild_id = :guild_id AND support_id = :support_id',
        { guild_id: params.guildId, support_id: params.supportId }
    );
    return rows[0] as CheckerRow;
}

export async function updateCheckerState(
    id: number,
    state: string | null,
    uptimeMs: number | null
) {
    await pool.query(
        'UPDATE checkers SET last_state = :state, last_uptime_ms = :uptime WHERE id = :id',
        { id, state, uptime: uptimeMs ?? null }
    );
}

export async function updateIntervalBySupportId(
    supportId: string,
    minutes: number
): Promise<number> {
    const [res] = await pool.query<mysql.ResultSetHeader>(
        'UPDATE checkers SET interval_minutes = :m WHERE support_id = :sid',
        { m: minutes, sid: supportId }
    );
    return res.affectedRows;
}

export async function getCheckersByGuild(guildId: string): Promise<CheckerRow[]> {
    const [rows] = await pool.query<mysql.RowDataPacket[] & CheckerRow[]>(
        'SELECT * FROM checkers WHERE guild_id = :guild_id',
        { guild_id: guildId }
    );
    return rows as CheckerRow[];
}

export async function deleteChecker(guildId: string, supportId: string): Promise<number> {
    const [res] = await pool.query<mysql.ResultSetHeader>(
        'DELETE FROM checkers WHERE guild_id = :gid AND support_id = :sid',
        { gid: guildId, sid: supportId }
    );
    return res.affectedRows;
}