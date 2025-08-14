const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const DISCORD_TOKEN = 'MTQwNTQzMDE3Nzk1NzI4MTgyMw.GFWaz_.5VaXwUUOn2i0DtsUgeA-THhM8YRqui0PpjKizo';

// Cache: lưu metadata trong RAM
const cache = new Map();

// Hàm lấy metadata
async function getMetadata(url) {
    if (cache.has(url)) {
        console.log(`Cache hit: ${url}`);
        return cache.get(url);
    }

    try {
        console.log(`Fetching: ${url}`);
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        const $ = cheerio.load(res.data);

        const title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Không có tiêu đề';
        const description = $('meta[property="og:description"]').attr('content') || '';
        const image = $('meta[property="og:image"]').attr('content') || '';

        const meta = { title, description, image };
        cache.set(url, meta);
        return meta;
    } catch (err) {
        console.error(`Lỗi lấy metadata: ${err}`);
        return null;
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (urls) {
        for (const url of urls) {
            const meta = await getMetadata(url);
            if (meta) {
                const embed = new EmbedBuilder()
                    .setTitle(meta.title)
                    .setURL(url)
                    .setDescription(meta.description.substring(0, 200))
                    .setColor(0x00AE86);

                if (meta.image) embed.setImage(meta.image);

                message.channel.send({ embeds: [embed] });
            }
        }
    }
});

client.login(DISCORD_TOKEN);
