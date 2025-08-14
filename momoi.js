const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

console.log("🚀 Bot starting...");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
if (!DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN chưa được cấu hình!");
    process.exit(1);
}

const cache = new Map();

async function getMetadata(url) {
    if (cache.has(url)) {
        console.log(`⚡ Cache hit: ${url}`);
        return cache.get(url);
    }

    try {
        console.log(`🌐 Fetching: ${url}`);
        const res = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000
        });
        const $ = cheerio.load(res.data);

        const title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Không có tiêu đề';
        const description = $('meta[property="og:description"]').attr('content') || '';
        const image = $('meta[property="og:image"]').attr('content') || '';

        const meta = { title, description, image };
        cache.set(url, meta);
        console.log(`✅ Metadata lấy thành công cho: ${url}`);
        return meta;
    } catch (err) {
        console.error(`❌ Lỗi lấy metadata cho ${url}:`, err.message);
        return null;
    }
}

client.on('ready', () => {
    console.log(`🤖 Bot đã đăng nhập thành công dưới tên: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    console.log(`💬 Tin nhắn nhận được: "${message.content}" từ ${message.author.tag}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (urls) {
        console.log(`🔗 Phát hiện ${urls.length} URL`);
        for (const url of urls) {
            const meta = await getMetadata(url);
            if (meta) {
                try {
                    const embed = new EmbedBuilder()
                        .setTitle(meta.title)
                        .setURL(url)
                        .setDescription(meta.description.substring(0, 200))
                        .setColor(0x00AE86);

                    if (meta.image) embed.setImage(meta.image);

                    await message.channel.send({ embeds: [embed] });
                    console.log(`📤 Đã gửi embed cho ${url}`);
                } catch (sendErr) {
                    console.error(`❌ Lỗi gửi embed cho ${url}:`, sendErr.message);
                }
            }
        }
    } else {
        console.log("ℹ️ Không tìm thấy URL trong tin nhắn.");
    }
});

client.login(DISCORD_TOKEN);
