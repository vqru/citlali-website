// /api/webhook.js — Vercel Serverless Function

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI2;
const TOPGG_WEBHOOK_SECRET = process.env.TOPGG_WEBHOOK_SECRET;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_LOG_WEBHOOK = process.env.DISCORD_LOG_WEBHOOK;
const VOTE_DURATION = 12 * 60 * 60 * 1000;

let cachedClient = null;

async function getDB() {
    if (!cachedClient) {
        cachedClient = await MongoClient.connect(MONGODB_URI);
    }
    return cachedClient.db('votetracker');
}

async function sendDM(userId, expiresAt) {
    if (!DISCORD_TOKEN) return;
    try {
        const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: userId })
        });
        if (!dmRes.ok) return;
        const dmChannel = await dmRes.json();
        const expiryUnix = Math.floor(expiresAt / 1000);
        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    color: 0xFFB6C1,
                    title: '✨ Premium Activated!',
                    description: `Thanks for voting! You now have **12 hours** of access to NSFW commands and chat!\n\n⏰ Expires: <t:${expiryUnix}:R>`,
                    footer: { text: '© vqru' },
                    timestamp: new Date().toISOString()
                }]
            })
        });
        console.log(`✅ DM sent to ${userId}`);
    } catch (e) {
        console.error(`❌ DM failed:`, e.message);
    }
}

async function logToDiscord(userId, username, avatar, voteTimestamp, expiresAt) {
    if (!DISCORD_LOG_WEBHOOK) return;
    try {
        const voteUnix = Math.floor(voteTimestamp / 1000);
        const expiryUnix = Math.floor(expiresAt / 1000);
        const avatarUrl = avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';
        await fetch(DISCORD_LOG_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    color: 0x6c63ff,
                    title: '🗳️ New Vote Received!',
                    thumbnail: { url: avatarUrl },
                    description:
                        `**User:** ${username} (\`${userId}\`)\n` +
                        `**Voted:** <t:${voteUnix}:F> (<t:${voteUnix}:R>)\n` +
                        `**Expires:** <t:${expiryUnix}:R>`,
                    timestamp: new Date().toISOString()
                }]
            })
        });
        console.log(`✅ Logged to Discord for ${userId}`);
    } catch (e) {
        console.error(`❌ Discord log failed:`, e.message);
    }
}

async function getDiscordUser(userId) {
    if (!DISCORD_TOKEN) return null;
    try {
        const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: { 'Authorization': `Bot ${DISCORD_TOKEN}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = req.headers['authorization'];
    if (TOPGG_WEBHOOK_SECRET && auth !== TOPGG_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { user, type } = req.body;

        if (!user) return res.status(400).json({ error: 'Missing user' });

        // Allow both 'upvote' and 'test' so Send Test also works
        if (type !== 'upvote' && type !== 'test') {
            return res.status(200).json({ message: 'Ignored' });
        }

        const now = Date.now();
        const expiresAt = now + VOTE_DURATION;

        // Save to MongoDB
        const db = await getDB();
        const existing = await db.collection('votes').findOne({ userId: user });
        const totalVotes = existing ? (existing.totalVotes || 0) + 1 : 1;

        await db.collection('votes').updateOne(
            { userId: user },
            { $set: { userId: user, lastVoteTime: now, expiresAt, totalVotes, updatedAt: new Date() } },
            { upsert: true }
        );

        await db.collection('premium').updateOne(
            { userId: user },
            { $set: { userId: user, premiumUntil: expiresAt, expiredWarnings: 0, lastVoteTimestamp: now, updatedAt: new Date() } },
            { upsert: true }
        );

        console.log(`✅ Vote saved for ${user}`);

        // Get Discord user info
        const discordUser = await getDiscordUser(user);
        const username = discordUser ? (discordUser.global_name || discordUser.username) : 'Unknown User';
        const avatar = discordUser ? discordUser.avatar : null;

        // Send DM + log — do this BEFORE responding so Vercel doesn't cut off
        await Promise.allSettled([
            sendDM(user, expiresAt),
            logToDiscord(user, username, avatar, now, expiresAt)
        ]);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('❌ Webhook error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
