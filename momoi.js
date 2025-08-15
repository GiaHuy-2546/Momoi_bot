// bot.js
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

// Lấy token từ biến môi trường
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_TOKEN = process.env.OPENGRAPH_TOKEN;

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

    for (let url of urls) {
        try {
            // Nếu là link Facebook /p/... thì follow redirect
            if (url.includes('facebook.com/share/p/')) {
                url = await resolveRedirect(url);
            }

            const meta = await getOpenGraph(url);

            if (meta.video) {
                console.log(`🎥 Tìm thấy video: ${meta.video}`);
                const videoBuffer = await downloadFile(meta.video);
                await processVideo(message, url, videoBuffer);
            } else if (meta.image) {
                await message.channel.send({ content: `🖼 ${url}`, files: [meta.image] });
            } else {
                await message.channel.send(`ℹ️ Không tìm thấy media cho link này: ${url}`);
            }

        } catch (err) {
            console.error(err);
            message.channel.send(`❌ Lỗi khi xử lý: ${url}`);
        }
    }
});

// --- Hàm follow redirect ---
async function resolveRedirect(url) {
    const res = await fetch(url, { redirect: 'follow' });
    return res.url;
}

// --- Lấy dữ liệu từ OpenGraph.io ---
async function getOpenGraph(url) {
    const apiUrl = `https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?app_id=${OPENGRAPH_TOKEN}`;
    const res = await axios.get(apiUrl);
    const og = res.data.hybridGraph || {};
    return {
        title: og.title,
        image: og.image,
        video: og.video || og.videoUrl
    };
}

// --- Download file ---
async function downloadFile(url) {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
}

// --- Xử lý video ---
async function processVideo(message, url, buffer) {
    const tempPath = path.join(process.cwd(), 'temp_video.mp4');
    fs.writeFileSync(tempPath, buffer);

    let size = fs.statSync(tempPath).size / (1024 * 1024);
    if (size <= 25) {
        await message.channel.send({ content: `🎥 ${url}`, files: [tempPath] });
        fs.unlinkSync(tempPath);
        return;
    }

    // Giảm bitrate
    const duration = await getVideoDuration(tempPath);
    const targetSizeBits = 24 * 1024 * 1024 * 8;
    const targetBitrate = Math.floor(targetSizeBits / duration);
    const compressedPath = path.join(process.cwd(), 'temp_video_compressed.mp4');

    await new Promise((resolve, reject) => {
        ffmpeg(tempPath)
            .videoBitrate(Math.floor(targetBitrate / 1000))
            .output(compressedPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });

    size = fs.statSync(compressedPath).size / (1024 * 1024);
    if (size <= 25) {
        await message.channel.send({ content: `🎥 ${url} (nén)`, files: [compressedPath] });
        cleanupFiles([tempPath, compressedPath]);
        return;
    }

    // Cắt 20 giây đầu
    const croppedPath = path.join(process.cwd(), 'temp_video_cropped.mp4');
    await new Promise((resolve, reject) => {
        ffmpeg(compressedPath)
            .setStartTime(0)
            .setDuration(20)
            .output(croppedPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });

    size = fs.statSync(croppedPath).size / (1024 * 1024);
    if (size <= 25) {
        await message.channel.send({ content: `🎥 ${url} (cắt 20s)`, files: [croppedPath] });
    } else {
        await message.channel.send(`📺 Video quá lớn (${size.toFixed(2)}MB): ${url}`);
    }

    cleanupFiles([tempPath, compressedPath, croppedPath]);
}

function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
}

function cleanupFiles(paths) {
    for (const file of paths) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
}

client.login(DISCORD_TOKEN);
