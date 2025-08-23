import { Client, GatewayIntentBits, Events, ActivityType, Guild } from 'discord.js';
import { config } from './config.js';
import { migrate, getAllCheckers, getCheckersByGuild, deleteChecker } from './db.js';
import { Scheduler } from './scheduler.js';
import { wireInteractionHandler } from './commands/_registry.js';

async function pruneOrphanGuilds(client: Client, scheduler: Scheduler) {
    const currentGuildIds = new Set(client.guilds.cache.map(g => g.id));
    const rows = await getAllCheckers();

    for (const r of rows) {
        if (!currentGuildIds.has(r.guild_id)) {
            scheduler.cancel(r.id);
            await deleteChecker(r.guild_id, r.support_id);
        }
    }
}

async function handleGuildDelete(guild: Guild, scheduler: Scheduler) {
    const rows = await getCheckersByGuild(guild.id);
    for (const r of rows) {
        scheduler.cancel(r.id);
        await deleteChecker(guild.id, r.support_id);
    }
}

async function main() {
    await migrate();

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const scheduler = new Scheduler(client);

    wireInteractionHandler(client, scheduler);

    client.once(Events.ClientReady, async (c) => {
        console.log(`Logged in as ${c.user.tag}`);
        c.user.setActivity({ name: '/setchecker', type: ActivityType.Listening });

        await scheduler.bootFromDatabase();

        await pruneOrphanGuilds(client, scheduler);
    });

    client.on(Events.GuildDelete, async (guild) => {
        await handleGuildDelete(guild, scheduler);
    });

    await client.login(config.discordToken);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
