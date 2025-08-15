// momoi.js
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Lấy token từ biến môi trường Railway
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_TOKEN = process.env.OPENGRAPH_TOKEN;

// Cấu hình ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

// Xử lý đường dẫn khi dùng ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Khởi tạo bot Discord
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập với tên ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (!urls) return;

    for (const url of urls) {
        try {
            console.log(`🔍 Đang xử lý: ${url}`);

            // Lấy metadata từ OpenGraph.io
            const ogRes = await axios.get(`https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}`, {
                params: { app_id: OPENGRAPH_TOKEN }
            });

            const data = ogRes.data?.hybridGraph || {};
            const isVideo = data.video && data.video.url;

            if (isVideo) {
                // Nếu là video, tải và cắt ngắn nếu quá dài
                const videoUrl = data.video.url;
                const outputPath = path.join(__dirname, 'video.mp4');

                console.log(`🎬 Tải video: ${videoUrl}`);
                await new Promise((resolve, reject) => {
                    ffmpeg(videoUrl)
                        .setStartTime('00:00:00')
                        .setDuration(30) // cắt 30 giây đầu
                        .output(outputPath)
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                });

                await message.channel.send({ files: [outputPath] });
                fs.unlinkSync(outputPath);
            } else {
                // Nếu không phải video, gửi ảnh như cũ
                if (data.image) {
                    await message.channel.send({ content: data.title || 'Không có tiêu đề', files: [data.image] });
                }
            }

        } catch (err) {
            console.error(`❌ Lỗi khi xử lý ${url}:`, err.message);
        }
    }
});

client.login(DISCORD_TOKEN);
