import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChatInputCommandInteraction, MessageFlags,
} from 'discord.js';
import { deleteChecker, getChecker } from '../db.js';
import type { Scheduler } from '../scheduler.js';

export const builder = new SlashCommandBuilder()
    .setName('removechecker')
    .setDescription('Usuń monitor dla podanego support_id z tego serwera.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o
        .setName('support_id')
        .setDescription('ID serwera, np. 07cebb5b')
        .setRequired(true));

export async function handle(interaction: ChatInputCommandInteraction, scheduler: Scheduler) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const supportId = interaction.options.getString('support_id', true);

    const row = await getChecker(interaction.guildId, supportId);
    if (!row) {
        await interaction.editReply(`ℹ️ Brak konfiguracji dla **${supportId}** na tym serwerze.`);
        return;
    }

    scheduler.cancel(row.id);
    const removed = await deleteChecker(interaction.guildId, supportId);

    console.log("Checker has been removed for support_id=", supportId, " (", removed, " affected) (guild=", interaction.guildId, ")")

    await interaction.editReply(
        removed > 0
            ? `🗑️ Usunięto checker dla **${supportId}**.`
            : `⚠️ Nie udało się usunąć checkera dla **${supportId}**.`
    );
}
