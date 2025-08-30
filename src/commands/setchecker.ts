import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ChatInputCommandInteraction, channelMention, MessageFlags
} from 'discord.js';
import { config } from '../config.js';
import { getChecker, upsertChecker } from '../db.js';
import type { Scheduler } from '../scheduler.js';

export const builder = new SlashCommandBuilder()
    .setName('setchecker')
    .setDescription('Skonfiguruj monitor stanu serwera (Pterodactyl).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o
        .setName('api_key')
        .setDescription('Klucz API Pterodactyl (Client API)')
        .setRequired(true))
    .addStringOption(o => o
        .setName('support_id')
        .setDescription('ID serwera, np. 07cebb5b')
        .setRequired(true))
    .addChannelOption(o => o
        .setName('channel')
        .setDescription('Kanał do powiadomień')
        .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
        .setRequired(true));

export async function handle(interaction: ChatInputCommandInteraction, scheduler: Scheduler) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const apiKey = interaction.options.getString('api_key', true);
    const supportId = interaction.options.getString('support_id', true);
    const channel = interaction.options.getChannel('channel', true, [
        ChannelType.GuildText,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
    ]);

    const existing = await getChecker(interaction.guildId, supportId);
    const interval = existing?.interval_minutes ?? config.defaultIntervalMinutes;

    const row = await upsertChecker({
        guildId: interaction.guildId,
        channelId: channel.id,
        supportId,
        apiKeyPlain: apiKey,
        intervalMinutes: interval,
    });

    scheduler.upsert(row);

    console.log("Checker has been set for support_id=", supportId, " (", row.id, ")", " (guild=", interaction.guildId, ")")

    await interaction.editReply(
        `✅ Monitor skonfigurowany dla **${supportId}** → ${channelMention(channel.id)}.\n` +
        `Interwał sprawdzania zmieniany jest wyłącznie przez developera bota.`
    );
}
