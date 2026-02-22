import { REST, Routes, Client, Events, Interaction, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import type { Scheduler } from '../scheduler.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Command {
    builder: SlashCommandBuilder;
    handle: (interaction: ChatInputCommandInteraction, scheduler: Scheduler) => Promise<void>;
}

const commands: Command[] = [];

async function loadCommands() {
    if (commands.length > 0) return commands;

    const files = fs.readdirSync(__dirname).filter(file => 
        (file.endsWith('.ts') || file.endsWith('.js')) && !file.startsWith('_')
    );

    for (const file of files) {
        const commandModule = await import(`./${file}`);
        if (commandModule.builder && commandModule.handle) {
            commands.push(commandModule as unknown as Command);
        }
    }

    return commands;
}

export async function getSlashCommandData() {
    const cmds = await loadCommands();
    return cmds.map(cmd => cmd.builder.toJSON());
}

export async function registerSlashCommandsGlobally() {
    const rest = new REST({ version: '10' }).setToken(config.discordToken);
    await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: await getSlashCommandData() }
    );
}

export function wireInteractionHandler(client: Client, scheduler: Scheduler) {
    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const cmds = await loadCommands();
        const command = cmds.find(cmd => cmd.builder.name === interaction.commandName);
        if (command) {
            await command.handle(interaction, scheduler);
        }
    });
}
