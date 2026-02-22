import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    channelMention,
    ChatInputCommandInteraction,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import {deleteChecker, getCheckersByGuild} from '../db.js';
import type {Scheduler} from '../scheduler.js';
import {getFormattedTime} from "../utils/format.js";

export const builder = new SlashCommandBuilder()
    .setName('checkerlist')
    .setDescription('Wyświetla listę wszystkich skonfigurowanych checkerów na tym serwerze.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function handle(interaction: ChatInputCommandInteraction, scheduler: Scheduler) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'Ta komenda działa tylko na serwerze.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let checkers = await getCheckersByGuild(interaction.guildId);

    if (checkers.length === 0) {
        await interaction.editReply('Brak skonfigurowanych checkerów na tym serwerze.');
        return;
    }

    let currentPage = 0;

    const createEmbed = (page: number) => {
        const checker = checkers[page];
        if (!checker) return new EmbedBuilder().setTitle('Błąd').setDescription('Nie znaleziono checkera.');
        
        return new EmbedBuilder()
            .setTitle(`Lista Checkerów (${page + 1}/${checkers.length})`)
            .setColor(0x0099ff)
            .addFields(
                {name: 'Support ID', value: `\`${checker.support_id}\``, inline: true},
                {name: 'Kanał', value: channelMention(checker.channel_id), inline: true},
                {name: 'Interwał', value: `${checker.interval_minutes} min`, inline: true},
                {name: 'Ostatni Stan', value: checker.last_state || 'Brak danych', inline: true},
                {name: 'ID Rekordu', value: checker.id.toString(), inline: true}
            )
            .setTimestamp()
            .setFooter({text: `Serwer: ${interaction.guild?.name}`});
    };

    const createButtons = (page: number) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('prev')
                .setLabel('Poprzedni')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('delete')
                .setLabel('Usuń')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('next')
                .setLabel('Następny')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === checkers.length - 1)
        );

        return row;
    };

    const response = await interaction.editReply({
        embeds: [createEmbed(currentPage)],
        components: [createButtons(currentPage)],
    });

    const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'Nie możesz używać tych przycisków.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (i.customId === 'prev') {
            currentPage--;
        } else if (i.customId === 'next') {
            currentPage++;
        } else if (i.customId === 'delete') {
            const checker = checkers[currentPage];
            if (checker) {
                scheduler.cancel(checker.id);
                await deleteChecker(interaction.guildId!, checker.support_id);
                console.log(`${getFormattedTime()} GUILD REMOVE (via list): support_id=${checker.support_id} (guild=${interaction.guildId}) by ${interaction.user.id}`);
                
                // Refresh list
                checkers = await getCheckersByGuild(interaction.guildId!);
                if (checkers.length === 0) {
                    await i.update({
                        content: 'Brak skonfigurowanych checkerów na tym serwerze.',
                        embeds: [],
                        components: [],
                    });
                    collector.stop();
                    return;
                }
                
                if (currentPage >= checkers.length) {
                    currentPage = checkers.length - 1;
                }
            }
        }

        await i.update({
            embeds: [createEmbed(currentPage)],
            components: [createButtons(currentPage)],
        });
    });

    collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
    });
}
