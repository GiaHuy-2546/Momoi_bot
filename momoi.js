import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import puppeteer from 'puppeteer';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENGRAPH_API_KEY = process.env.OPENGRAPH_API_KEY;
const MAX_DISCORD_FILE = 8 * 1024 * 1024;

if (!DISCORD_TOKEN || !OPENGRAPH_API_KEY) {
    console.error('❌ Thiếu DISCORD_TOKEN hoặc OPENGRAPH_API_KEY.');
    process.exit(1);
}

const tempDir = '/tmp'; // Railway chỉ cho ghi ở đây

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

function sanitizeUrl(u) {
    try {
        const url = new URL(u);
        if (/^(www|web|m|mbasic)\.facebook\.com$/.test(url.hostname) || /fb\.watch/.test(url.hostname)) {
            if (url.hostname !== 'm.facebook.com') {
                url.hostname = 'm.facebook.com';
            }
            return url.toString();
        }
        return u;
    } catch {
        return u;
    }
}

async function fetchPreviewImage(url) {
    try {
        const res = await axios.get(`https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}`, {
            params: { app_id: OPENGRAPH_API_KEY },
            timeout: 15000,
        });
        return res.data?.hybridGraph?.image || null;
    } catch (e) {
        console.error('❌ Lỗi OpenGraph:', e.message);
        return null;
    }
}

async function fetchFacebookVideo(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForTimeout(2000);

        const videoUrl = await page.evaluate(() => {
            const hd = document.querySelector('video')?.src;
            if (hd) return hd;
            const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
            for (let script of scripts) {
                const match = script.match(/https:\\\/\\\/[^"]+\.mp4/);
                if (match) return match[0].replace(/\\\//g, '/');
            }
            return null;
        });

        return videoUrl;
    } catch (err) {
        console.error('❌ Puppeteer error:', err.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function sendVideo(message, videoUrl) {
    try {
        const head = await axios.head(videoUrl, { maxRedirects: 5 });
        const size = parseInt(head.headers["content-length"] || "0", 10);

        const tempPath = path.join(tempDir, `video_${Date.now()}.mp4`);
        const writer = fs.createWriteStream(tempPath);
        const downloadRes = await axios.get(videoUrl, { responseType: "stream" });
        downloadRes.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        let finalPath = tempPath;

        if (size > MAX_DISCORD_FILE) {
            console.log("📦 Nén video...");
            const compressedPath = path.join(tempDir, `video_compressed_${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                exec(
                    `ffmpeg -y -i "${tempPath}" -vf "scale=1280:-2" -b:v 800k -c:a aac -b:a 96k "${compressedPath}"`,
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });

            fs.unlinkSync(tempPath);
            finalPath = compressedPath;
        }

        await message.channel.send({
            content: `🎥 Video từ Facebook:`,
            files: [finalPath],
        });

        fs.unlinkSync(finalPath);
    } catch (err) {
        console.error("❌ Lỗi khi gửi video:", err.message);
        await message.channel.send(`Không thể gửi video.`);
    }
}

async function handleFacebookLink(url, message) {
    url = sanitizeUrl(url);
    console.log(`📘 Xử lý: ${url}`);

    const videoUrl = await fetchFacebookVideo(url);

    if (videoUrl) {
        console.log("🎯 Lấy được video:", videoUrl);
        await sendVideo(message, videoUrl);
    } else {
        console.log("📷 Không có video → lấy ảnh");
        const imageUrl = await fetchPreviewImage(url);
        if (imageUrl) {
            await message.channel.send({
                content: `📷 Ảnh xem trước:`,
                files: [imageUrl],
            });
        } else {
            await message.channel.send(`❌ Không tìm thấy video hoặc ảnh từ: ${url}`);
        }
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (!urls) return;

    for (let url of urls) {
        if (/facebook\.com|fb\.watch/i.test(url)) {
            await handleFacebookLink(url, message);
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập với tên ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
