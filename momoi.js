// ... các import và biến như cũ
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MAX_DISCORD_FILE = 8 * 1024 * 1024;

if (!DISCORD_TOKEN) {
    console.error('❌ Thiếu DISCORD_TOKEN.');
    process.exit(1);
}

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
});

// ================== Xử lý Facebook Video ==================
async function handleFacebookVideo(url, message) {
    try {
        console.log(`📘 Phát hiện Facebook video: ${url}`);

        // 1. Nếu là link /share/v/... hoặc /share/p/... thì tìm link gốc
        if (/facebook\.com\/share\/[vp]\//.test(url)) {
            console.log("🔍 Đang tìm link gốc từ trang share...");
            const resShare = await axios.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                maxRedirects: 5,
            });
            const htmlShare = resShare.data;
            const match = htmlShare.match(/https:\/\/www\.facebook\.com\/[^"']+\/videos\/\d+/);
            if (match) {
                url = match[0];
                console.log("➡️ Link gốc:", url);
            } else {
                console.warn("⚠️ Không tìm thấy link gốc từ trang share.");
            }
        }

        // 2. Lấy HTML từ link video gốc
        const res = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept-Language": "en-US,en;q=0.9",
            },
            maxRedirects: 5,
        });

        const html = res.data;

        // 3. Regex tìm link MP4 (ưu tiên HD)
        let match =
            html.match(/"hd_src_no_ratelimit":"(https:\\/\\/[^"]+?\.mp4[^"]*)"/) ||
            html.match(/"sd_src_no_ratelimit":"(https:\\/\\/[^"]+?\.mp4[^"]*)"/) ||
            html.match(/"hd_src":"(https:\\/\\/[^"]+?\.mp4[^"]*)"/) ||
            html.match(/"sd_src":"(https:\\/\\/[^"]+?\.mp4[^"]*)"/);

        // 4. Nếu không có video → thử lấy ảnh
        if (!match) {
            console.error("❌ Không tìm thấy link MP4 trong HTML, thử lấy ảnh...");
            const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
            if (imgMatch) {
                await message.channel.send({
                    content: `📷 Không tìm thấy video, gửi ảnh xem trước:`,
                    files: [imgMatch[1]],
                });
            } else {
                await message.channel.send(`❌ Không tìm thấy video hoặc ảnh từ: ${url}`);
            }
            return;
        }

        let videoUrl = match[1].replace(/\\/g, "");
        console.log("🎯 Lấy được video:", videoUrl);

        // 5. Kiểm tra dung lượng
        const head = await axios.head(videoUrl, { maxRedirects: 5 });
        const size = parseInt(head.headers["content-length"] || "0", 10);
        console.log("📏 Kích thước video:", size, "bytes");

        // 6. Tải video
        const tempPath = path.join(tempDir, `fbvideo_${Date.now()}.mp4`);
        const writer = fs.createWriteStream(tempPath);
        const downloadRes = await axios.get(videoUrl, { responseType: "stream" });
        downloadRes.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        let finalPath = tempPath;

        // 7. Nén nếu vượt giới hạn
        if (size > MAX_DISCORD_FILE) {
            console.log("📦 Video lớn hơn giới hạn → Đang nén lại...");
            const compressedPath = path.join(tempDir, `fbvideo_compressed_${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                exec(
                    `ffmpeg -y -i "${tempPath}" -vf "scale=1280:-2" -b:v 800k -c:a aac -b:a 128k "${compressedPath}"`,
                    (err) => {
                        if (err) return reject(err);
                        resolve();
                    }
                );
            });

            fs.unlinkSync(tempPath);
            finalPath = compressedPath;
        }

        // 8. Gửi video lên Discord
        await message.channel.send({
            content: `🎥 Video từ Facebook:`,
            files: [finalPath],
        });

        fs.unlinkSync(finalPath);
    } catch (err) {
        console.error("❌ Lỗi khi xử lý video Facebook:", err);
        await message.channel.send(`Không thể xử lý video từ: ${url}`);
    }
}

// ================== Bot Message Event ==================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);
    if (!urls) return;

    for (let url of urls) {
        if (/facebook\.com|fb\.watch/i.test(url)) {
            await handleFacebookVideo(url, message);
        }
    }
});

client.once('ready', () => {
    console.log(`✅ Bot đã đăng nhập với tên ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
