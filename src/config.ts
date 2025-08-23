import 'dotenv/config';

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

export const config = {
    discordToken: requireEnv('DISCORD_TOKEN'),
    discordClientId: requireEnv('DISCORD_CLIENT_ID'),
    mysql: {
        host: requireEnv('MYSQL_HOST'),
        port: Number(process.env.MYSQL_PORT ?? '3306'),
        user: requireEnv('MYSQL_USER'),
        password: requireEnv('MYSQL_PASSWORD'),
        database: requireEnv('MYSQL_DATABASE'),
    },
    defaultIntervalMinutes: Number(process.env.DEFAULT_CHECK_INTERVAL_MINUTES ?? '5'),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? '10000'),
    userAgent: process.env.USER_AGENT ?? 'DiscordCheckerBot/1.0',
    encryptionKeyBase64: requireEnv('ENCRYPTION_KEY'),
    botOwnerIds: (process.env.BOT_OWNER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
};