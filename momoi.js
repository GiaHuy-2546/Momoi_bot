// momoi.js

import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

// Lấy token từ biến môi trường Railway
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_TOKEN = process.env.OPENGRAPH_TOKEN;

if (!DISCORD_TOKEN || !OPENGRAPH_TOKEN) {
    console.error('❌ Thiếu DISCORD_TOKEN hoặc OPENGRAPH_TOKEN trong biến môi trường.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// Hàm tải và cắt video nếu quá dài (>30s)
async function downloadAndTrimVideo(videoUrl, outputFile) {
    return new Promise((resolve, reject) => {
        ffmpeg(videoUrl)
            .setStartTime(0)
            .setDuration(30) // chỉ lấy 30 giây đầu
            .output(outputFile)
            .on('end', () => resolve(outputFile))
            .on('error', reject)
            .run();
    });
}

// Hàm xử lý tin nhắn chứa link
async function handleLink(message, url) {
    try {
        console.log(`🔍 Đang xử lý: ${url}`);

        // Nếu là link /p thì bỏ bớt phần /p
        if (url.includes('/p/')) {
            const parts = url.split('/p/');
            url = parts[0]; // lấy phần trước /p
            console.log(`✂ Đã cắt link: ${url}`);
        }

        // Lấy metadata từ OpenGraph.io
        const apiUrl = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${OPENGRAPH_TOKEN}`;
        const response = await axios.get(apiUrl);
        const ogData = response.data.openGraph;

        // Nếu là video
        if (ogData.video && ogData.video.url) {
            const videoUrl = ogData.video.url;
            console.log(`🎥 Phát hiện video: ${videoUrl}`);

            const videoPath = path.join(process.cwd(), 'temp_video.mp4');
            await downloadAndTrimVideo(videoUrl, videoPath);

            await message.reply({
                content: `🎬 Video từ: ${url}`,
                files: [videoPath]
            });

            fs.unlinkSync(videoPath); // xóa file tạm
        }
        // Nếu là ảnh
        else if (ogData.image && ogData.image.url) {
            await message.reply({
                content: `📄 ${ogData.title || 'Không có tiêu đề'}\n🔗 ${url}`,
                files: [ogData.image.url]
            });
        }
        // Nếu không có ảnh/video
        else {
            await message.reply(`ℹ ${ogData.title || 'Không có tiêu đề'}\n🔗 ${url}`);
        }

    } catch (err) {
        console.error(`❌ Lỗi khi xử lý ${url}:`, err.message);
        message.reply(`❌ Không thể lấy dữ liệu từ: ${url}`);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Tìm link trong tin nhắn
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (!urls) return;

    for (const url of urls) {
        await handleLink(message, url);
    }
});

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập với tên ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
