import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { config } from './config.js';
import { migrate } from './db.js';
import { Scheduler } from './scheduler.js';
import { wireInteractionHandler } from './commands/_registry.js';

async function main() {
    await migrate();

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const scheduler = new Scheduler(client);

    wireInteractionHandler(client, scheduler);

    client.once(Events.ClientReady, async (c) => {
        console.log(`Logged in as ${c.user.tag}`);
        c.user.setActivity({ name: 'Use /setchecker', type: ActivityType.Custom });
        await scheduler.bootFromDatabase();
    });

    await client.login(config.discordToken);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});