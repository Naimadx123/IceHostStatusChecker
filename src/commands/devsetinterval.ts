import {SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags} from 'discord.js';
import { config } from '../config.js';
import { getCheckersBySupportId, updateIntervalBySupportId } from '../db.js';
import type { Scheduler } from '../scheduler.js';

export const builder = new SlashCommandBuilder()
    .setName('devsetinterval')
    .setDescription('USTAWIENIA DEV: zmień interwał sprawdzania dla support_id (minuty).')
    .addStringOption(o => o
        .setName('support_id')
        .setDescription('ID serwera, np. 07cebb5b')
        .setRequired(true))
    .addIntegerOption(o => o
        .setName('interval')
        .setDescription('Interwał w minutach (1–1440)')
        .setMinValue(1)
        .setMaxValue(1440)
        .setRequired(true));

function isOwner(userId: string) {
    return config.botOwnerIds.includes(userId);
}

export async function handle(interaction: ChatInputCommandInteraction, scheduler: Scheduler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!isOwner(interaction.user.id)) {
        await interaction.editReply('⛔ Tylko developer bota może użyć tej komendy.');
        return;
    }

    const supportId = interaction.options.getString('support_id', true);
    const interval = interaction.options.getInteger('interval', true);

    const affected = await updateIntervalBySupportId(supportId, interval);

    const rows = await getCheckersBySupportId(supportId);
    for (const r of rows) scheduler.upsert(r);

    console.log("Interval has been changed for support_id=", supportId, " to ", interval, " min. (", affected, " affected) (guild=", interaction.guildId, ")")

    await interaction.editReply(
        affected > 0
            ? `✅ Zmieniono interwał dla support_id=**${supportId}** na **${interval} min** (rekordów: ${affected}).`
            : `ℹ️ Brak rekordów dla support_id=**${supportId}**.`
    );
}
