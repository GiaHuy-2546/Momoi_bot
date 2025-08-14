const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.BOT_TOKEN; // Lấy từ biến môi trường
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`🚀 Bot starting...`);
    console.log(`🤖 Bot đã đăng nhập thành công dưới tên: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    console.log(`💬 Tin nhắn nhận được: "${message.content}" từ ${message.author.username}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (!urls) {
        console.log(`ℹ️ Không tìm thấy URL trong tin nhắn.`);
        return;
    }

    console.log(`🔗 Phát hiện ${urls.length} URL`);

    for (const url of urls) {
        if (url.includes('facebook.com')) {
            // Embed tùy chỉnh cho Facebook
            const fbEmbed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle('📌 Link Facebook được chia sẻ')
                .setDescription(`[Nhấn vào đây để xem bài viết](${url})`)
                .setFooter({ text: `Người gửi: ${message.author.tag}` })
                .setTimestamp();

            await message.channel.send({ embeds: [fbEmbed] });
            console.log(`✅ Gửi embed Facebook thành công cho: ${url}`);
        } else {
            // Thử lấy metadata cho link khác
            try {
                console.log(`🌐 Fetching: ${url}`);
                const { data } = await axios.get(url, { timeout: 5000 });
                const titleMatch = data.match(/<title>(.*?)<\/title>/i);
                const title = titleMatch ? titleMatch[1] : 'Không có tiêu đề';

                const embed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle(title)
                    .setURL(url)
                    .setFooter({ text: `Người gửi: ${message.author.tag}` })
                    .setTimestamp();

                await message.channel.send({ embeds: [embed] });
                console.log(`✅ Gửi embed thành công cho: ${url}`);
            } catch (err) {
                console.log(`❌ Lỗi khi lấy metadata cho ${url}: ${err.message}`);
                const fallbackEmbed = new EmbedBuilder()
                    .setColor(0xe74c3c)
                    .setTitle('🔗 Link được chia sẻ')
                    .setDescription(`[Nhấn vào đây để xem link](${url})`)
                    .setFooter({ text: `Người gửi: ${message.author.tag}` })
                    .setTimestamp();

                await message.channel.send({ embeds: [fallbackEmbed] });
            }
        }
    }
});

client.login(TOKEN);
