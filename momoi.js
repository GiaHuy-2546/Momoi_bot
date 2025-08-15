import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
    console.error('❌ Thiếu DISCORD_TOKEN.');
    process.exit(1);
}

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const MAX_DISCORD_FILE = 8 * 1024 * 1024; // 8MB cho Discord free

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

// Hàm nén video với bitrate cho trước
async function compressVideo(videoUrl, outputFile, bitrate) {
    return new Promise((resolve, reject) => {
        ffmpeg(videoUrl)
            .setStartTime(0)
            .setDuration(30) // chỉ lấy 30 giây đầu
            .videoCodec('libx264')
            .size('?x720') // giữ HD nhưng scale theo tỉ lệ
            .videoBitrate(`${bitrate}k`)
            .outputOptions('-preset veryfast')
            .output(outputFile)
            .on('end', () => resolve(outputFile))
            .on('error', reject)
            .run();
    });
}

// Tải và nén video cho đến khi đủ nhỏ
async function downloadAndAutoCompress(videoUrl, baseName) {
    let bitrate = 800; // kbps ban đầu
    for (let attempt = 1; attempt <= 5; attempt++) {
        const outPath = path.join(tempDir, `${baseName}_try${attempt}.mp4`);
        await compressVideo(videoUrl, outPath, bitrate);

        const size = fs.statSync(outPath).size;
        if (size <= MAX_DISCORD_FILE) {
            return outPath; // thành công
        }

        fs.unlinkSync(outPath); // xoá file lớn quá
        bitrate = Math.max(200, Math.floor(bitrate * 0.8)); // giảm 20%, tối thiểu 200kbps
    }
    return null; // thất bại
}

// Hàm xử lý video Facebook
async function handleFacebookVideo(message, url) {
    try {
        console.log(`📘 Phát hiện Facebook video: ${url}`);

        // Gọi API fdown.net để lấy link mp4
        const apiURL = `https://fdown.net/download.php?video=${encodeURIComponent(url)}`;
        const res = await axios.get(apiURL, { timeout: 15000 });

        const match = res.data.match(/https?:\/\/[^"]+\.mp4/);
        if (!match) {
            console.log(`ℹ Không có video, thử lấy ảnh từ OG: ${url}`);
            try {
                const ogUrl = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${process.env.OPENGRAPH_TOKEN}`;
                const ogRes = await axios.get(ogUrl, { timeout: 10000 });
                const ogData = ogRes.data?.openGraph || {};
                
                if (ogData.image?.url) {
                    return message.reply({
                        content: `🖼 Ảnh từ bài Facebook\n🔗 ${url}`,
                        files: [ogData.image.url]
                    });
                } else {
                    return message.reply(`ℹ Không tìm thấy video hoặc ảnh từ Facebook.\n🔗 ${url}`);
                }
            } catch (err) {
                console.error(`❌ Lỗi khi lấy ảnh OG:`, err.message);
                return message.reply(`ℹ Không tìm thấy video hoặc ảnh từ Facebook.\n🔗 ${url}`);
            }
        }
        

        const videoUrl = match[0];
        const baseName = `fb_${Date.now()}`;

        const finalPath = await downloadAndAutoCompress(videoUrl, baseName);

        if (!finalPath) {
            return message.reply(`⚠ Video quá lớn và không thể nén đủ nhỏ để gửi.\n🔗 ${url}`);
        }

        await message.reply({
            content: `🎬 Video Facebook từ: ${url}`,
            files: [finalPath]
        });

        fs.unlinkSync(finalPath);
    } catch (err) {
        console.error(`❌ Lỗi khi xử lý video Facebook:`, err.message);
        message.reply(`❌ Không thể xử lý video từ Facebook.\n🔗 ${url}`);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (!urls) return;

    for (let url of urls) {
        if (/facebook\.com|fb\.watch/i.test(url)) {
            if (url.includes('/p/')) {
                url = url.split('/p/')[0];
                console.log(`✂ Đã cắt link: ${url}`);
            }
            await handleFacebookVideo(message, url);
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập với tên ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
