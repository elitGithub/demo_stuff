export default class CampaignBuilder {
    /**
     * @param {string} player
     */
    constructor(player) {
        this.playerName = player;
        this.raw = [];
    }

    /**
     * @return {object[]}
     */
    get messages() {
        return this.raw;
    }

    /**
     * @param {string} sender
     * @param {Array<{ speakerName: string, position: string, text: string, type?: string }>} blocks
     * @return {CampaignBuilder}
     */
    append(sender, blocks) {
        const number = this.raw.length + 1;
        this.raw.push({
            id: `MESSAGE-${number}`,
            sender: { type: sender },
            contents: blocks.map((block) => ({ type: 'TEXT', ...block })),
            edited: false,
            messageTime: new Date(Date.UTC(2026, 10, 3, 11, 0, number)).toISOString(),
        });
        return this;
    }

    /**
     * @param {string} text
     * @return {CampaignBuilder}
     */
    player(text) {
        return this.append('USER', [{ speakerName: this.playerName, position: 'RIGHT', text }]);
    }

    /**
     * @param {string} text
     * @return {CampaignBuilder}
     */
    narrator(text) {
        return this.append('BOT', [{ speakerName: 'Narrator', position: 'NARRATOR', text }]);
    }

    /**
     * @param {string} speaker
     * @param {string} text
     * @return {CampaignBuilder}
     */
    says(speaker, text) {
        return this.append('BOT', [{ speakerName: speaker, position: 'LEFT', text }]);
    }

    /**
     * @param {Array<[string, string]>} blocks
     * @return {CampaignBuilder}
     */
    reply(blocks) {
        return this.append(
            'BOT',
            blocks.map(([speaker, text]) => ({
                speakerName: speaker,
                position: speaker === 'Narrator' ? 'NARRATOR' : 'LEFT',
                text,
            })),
        );
    }

    /**
     * @param {string} time
     * @return {CampaignBuilder}
     */
    timed(time) {
        this.raw[this.raw.length - 1].messageTime = time;
        return this;
    }

    /**
     * @param {Array<[string, string, string]>} blocks
     * @return {CampaignBuilder}
     */
    playerBlocks(blocks) {
        return this.append(
            'USER',
            blocks.map(([speaker, position, text]) => ({ speakerName: speaker, position, text })),
        );
    }
}
