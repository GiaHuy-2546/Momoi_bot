const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_API_KEY = process.env.OPENGRAPH_API_KEY;

if (!DISCORD_TOKEN || !OPENGRAPH_API_KEY) {
    console.error("❌ Bạn cần đặt DISCORD_TOKEN và OPENGRAPH_API_KEY trong Railway Variables!");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

console.log("🚀 Bot starting...");

client.once('ready', () => {
    console.log(`🤖 Bot đã đăng nhập thành công dưới tên: ${client.user.tag}`);
});

async function sendVideo(message, url, videoBuffer) {
    const tempPath = path.join(__dirname, 'temp_video.mp4');
    fs.writeFileSync(tempPath, videoBuffer);

    let fileSize = fs.statSync(tempPath).size / (1024 * 1024); // MB

    if (fileSize <= 25) {
        await message.channel.send({ content: `🎥 Video từ: ${url}`, files: [tempPath] });
        fs.unlinkSync(tempPath);
        return;
    }

    // Video > 25MB → tự cắt giảm bitrate
    const targetSizeMB = 24; // để an toàn < 25MB
    const durationSec = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });

    const targetSizeBits = targetSizeMB * 1024 * 1024 * 8;
    const targetBitrate = Math.floor(targetSizeBits / durationSec); // bps

    const tempCropped = path.join(__dirname, 'temp_video_cropped.mp4');

    await new Promise((resolve, reject) => {
        ffmpeg(tempPath)
            .videoBitrate(Math.floor(targetBitrate / 1000)) // kbps
            .output(tempCropped)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });

    fileSize = fs.statSync(tempCropped).size / (1024 * 1024);

    if (fileSize <= 25) {
        await message.channel.send({ content: `🎥 Video từ: ${url} (đã cắt)`, files: [tempCropped] });
    } else {
        await message.channel.send(`🎥 Video quá lớn (${fileSize.toFixed(2)} MB), xem tại: ${url}`);
    }

    fs.unlinkSync(tempPath);
    if (fs.existsSync(tempCropped)) fs.unlinkSync(tempCropped);
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (!urls) return;

    for (const url of urls) {
        console.log(`🔗 Phát hiện URL: ${url}`);

        try {
            const apiUrl = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${OPENGRAPH_API_KEY}`;
            const res = await axios.get(apiUrl);

            if (!res.data || !res.data.hybridGraph) {
                console.log(`❌ Không lấy được metadata cho ${url}`);
                continue;
            }

            const data = res.data.hybridGraph;
            const title = data.title || "Không có tiêu đề";
            const description = data.description || "";
            const image = data.image;
            const video = data.video;

            if (video) {
                console.log(`🎥 Phát hiện video: ${video}`);
                try {
                    const videoRes = await axios.get(video, { responseType: 'arraybuffer' });
                    await sendVideo(message, url, videoRes.data);
                } catch (err) {
                    console.error(`❌ Lỗi tải video: ${err.message}`);
                    await message.channel.send(`Không thể tải video từ: ${url}`);
                }
            } else {
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setURL(url)
                    .setDescription(description)
                    .setColor(0x00AE86);

                if (image) embed.setImage(image);

                await message.channel.send({ embeds: [embed] });
            }

        } catch (err) {
            console.error(`❌ Lỗi xử lý ${url}: ${err.message}`);
        }
    }
});

client.login(DISCORD_TOKEN);
