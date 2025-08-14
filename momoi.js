// momoi.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// ==== ĐỌC TOKEN VÀ API KEY TỪ ENV ====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_API_KEY = process.env.OPENGRAPH_API_KEY;

if (!DISCORD_TOKEN || !OPENGRAPH_API_KEY) {
    console.error("❌ Thiếu DISCORD_TOKEN hoặc OPENGRAPH_API_KEY trong biến môi trường");
    process.exit(1);
}

// ==== TẠO BOT ====
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🤖 Bot đã đăng nhập thành công dưới tên: ${client.user.tag}`);
});

// ==== HÀM LẤY METADATA ====
async function getOpenGraph(url) {
    try {
        const apiURL = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${OPENGRAPH_API_KEY}`;
        const res = await axios.get(apiURL);

        if (res.data && res.data.hybridGraph) {
            return {
                title: res.data.hybridGraph.title || 'Không có tiêu đề',
                description: res.data.hybridGraph.description || '',
                image: res.data.hybridGraph.image || ''
            };
        }
    } catch (err) {
        console.error('❌ Lỗi lấy OpenGraph:', err.message);
    }
    return null;
}

// ==== XỬ LÝ TIN NHẮN ====
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const fbRegex = /(https?:\/\/(?:www\.)?facebook\.com\/[^\s]+)/gi;
    const match = message.content.match(fbRegex);

    if (match) {
        const fbLink = match[0];
        console.log(`🔗 Phát hiện link Facebook: ${fbLink}`);

        const og = await getOpenGraph(fbLink);

        if (og) {
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(og.title)
                .setDescription(og.description || ' ')
                .setURL(fbLink)
                .setImage(og.image)
                .setFooter({ text: `Người gửi: ${message.author.username}` });

            message.channel.send({ embeds: [embed] });
        } else {
            message.channel.send(`📎 [Link Facebook](${fbLink})`);
        }
    }
});

// ==== CHẠY BOT ====
client.login(DISCORD_TOKEN);
