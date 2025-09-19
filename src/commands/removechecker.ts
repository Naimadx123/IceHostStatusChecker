import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChatInputCommandInteraction, MessageFlags,
} from 'discord.js';
import { deleteChecker, getChecker, getCheckersBySupportId } from '../db.js';
import type { Scheduler } from '../scheduler.js';
import { config } from '../config.js';
import {isOwner} from "../utils/helper";
import {getFormattedTime} from "../utils/format";

export const builder = new SlashCommandBuilder()
    .setName('removechecker')
    .setDescription('Usuń monitor dla podanego support_id.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o
        .setName('support_id')
        .setDescription('ID serwera, np. 07cebb5b')
        .setRequired(true)
    );

export async function handle(interaction: ChatInputCommandInteraction, scheduler: Scheduler) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const supportId = interaction.options.getString('support_id', true);
    const owner = isOwner(interaction.user.id);

    if (owner) {
        const rows = await getCheckersBySupportId(supportId);
        if (!rows.length) {
            await interaction.editReply(`ℹ️ Brak konfiguracji dla **${supportId}** w bazie.`);
            return;
        }

        let removed = 0;
        for (const r of rows) {
            scheduler.cancel(r.id);
            removed += await deleteChecker(r.guild_id, r.support_id);
        }

        console.log(
            `${getFormattedTime()} DEV REMOVE: user_id=${interaction.user.id} support_id=${supportId} -> removed ${removed} record(s) across ${new Set(rows.map(r => r.guild_id)).size} guild(s)`
        );
      
        await interaction.editReply(
            `🗑️ (DEV) Usunięto checker dla **${supportId}** we wszystkich znalezionych wpisach (rekordów: ${removed}).`
        );
        return;
    }

    const guildId = interaction.guildId;
    const row = await getChecker(guildId, supportId);
    if (!row) {
        await interaction.editReply(`ℹ️ Brak konfiguracji dla **${supportId}** na tym serwerze.`);
        return;
    }

    scheduler.cancel(row.id);
    const removed = await deleteChecker(guildId, supportId);

    console.log(
        `${getFormattedTime()} GUILD REMOVE: support_id=${supportId} (guild=${guildId}) -> removed ${removed} record(s) by ${interaction.user.id}`
    );

    console.log(getFormattedTime(), "Checker has been removed for support_id=", supportId, " (", removed, " affected) (guild=", interaction.guildId, ") by",interaction.user.id)



    await interaction.editReply(
        removed > 0
            ? `🗑️ Usunięto checker dla **${supportId}**.`
            : `⚠️ Nie udało się usunąć checkera dla **${supportId}**.`
    );
}
