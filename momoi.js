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

// ================== Tìm link gốc từ trang share ==================
async function getOriginalFacebookLink(shareUrl) {
    if (!/facebook\.com\/share\/[vp]\//.test(shareUrl)) return shareUrl;
    try {
        console.log("🔍 Đang tìm link gốc từ trang share...");
        const res = await axios.get(shareUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US,en;q=0.9",
            },
            maxRedirects: 5,
        });
        const html = res.data;
        const match = html.match(/https:\/\/www\.facebook\.com\/[^"']+\/videos\/\d+/);
        if (match) {
            console.log("➡️ Link gốc:", match[0]);
            return match[0];
        }
        console.warn("⚠️ Không tìm thấy link gốc từ trang share.");
        return shareUrl;
    } catch (err) {
        console.error("❌ Lỗi khi tìm link gốc:", err.message);
        return shareUrl;
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

// ================== Puppeteer lấy video và ảnh ==================
async function fetchFacebookVideoAndImage(url) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let videoUrl = null;
    let imageUrl = null;

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Cuộn xuống để load ảnh
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 300);
            });
        });

        await new Promise(r => setTimeout(r, 2000));

        // Lấy link video nếu có
        videoUrl = await page.evaluate(() => {
            const vid = document.querySelector('video');
            if (vid?.src) return vid.src;
            const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
            for (let script of scripts) {
                const match = script.match(/https:\\\/\\\/[^"]+\.mp4/);
                if (match) return match[0].replace(/\\\//g, '/');
            }
            return null;
        });

        // Nếu không có video → tìm ảnh
        if (!videoUrl) {
            imageUrl = await page.evaluate(() => {
                // Thử lấy meta og:image trước
                const meta = document.querySelector('meta[property="og:image"]');
                if (meta && meta.content && !meta.content.includes('facebook.com/images')) {
                    return meta.content;
                }
                // Nếu meta rác (logo FB) → tìm ảnh trong nội dung bài
                const img = document.querySelector('img[src*="scontent"]');
                return img ? img.src : null;
            });
        }

    } catch (err) {
        console.error('❌ Puppeteer error:', err.message);
    } finally {
        await browser.close();
    }

    return { videoUrl, imageUrl };
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
    // Bước 1: chuẩn hóa URL
    url = sanitizeUrl(url);
    // Bước 2: nếu là link share thì tìm link gốc
    url = await getOriginalFacebookLink(url);

    console.log(`📘 Xử lý: ${url}`);

    const { videoUrl, imageUrl } = await fetchFacebookVideoAndImage(url);

    if (videoUrl) {
        console.log("🎯 Lấy được video:", videoUrl);
        await sendVideo(message, videoUrl);
    } else if (imageUrl) {
        console.log("📷 Lấy được ảnh trực tiếp:", imageUrl);
        await message.channel.send({
            content: `📷 Ảnh xem trước:`,
            files: [imageUrl],
        });
    } else {
        console.log("📷 Thử OpenGraph.io...");
        const ogImage = await fetchPreviewImage(url);
        if (ogImage) {
            await message.channel.send({
                content: `📷 Ảnh xem trước (OpenGraph):`,
                files: [ogImage],
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
