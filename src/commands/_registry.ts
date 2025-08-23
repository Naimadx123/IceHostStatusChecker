import { REST, Routes, Client, Events, Interaction } from 'discord.js';
import { builder as setcheckerBuilder, handle as setcheckerHandle } from './setchecker.js';
import { builder as devSetIntervalBuilder, handle as devSetIntervalHandle } from './devsetinterval.js';
import { config } from '../config.js';
import type { Scheduler } from '../scheduler.js';

export function getSlashCommandData() {
    return [setcheckerBuilder.toJSON(), devSetIntervalBuilder.toJSON()];
}

export async function registerSlashCommandsGlobally() {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);
    await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: getSlashCommandData() }
    );
}

export function wireInteractionHandler(client: Client, scheduler: Scheduler) {
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        switch (interaction.commandName) {
            case 'setchecker':
                await setcheckerHandle(interaction, scheduler);
                break;
            case 'devsetinterval':
                await devSetIntervalHandle(interaction, scheduler);
                break;
            default:
                break;
        }
    });
}
