// /api/webhook.js — Vercel Serverless Function
// Receives top.gg vote webhooks, saves to MongoDB, sends DM, logs to Discord

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI2;
const TOPGG_WEBHOOK_SECRET = process.env.TOPGG_WEBHOOK_SECRET;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_LOG_WEBHOOK = process.env.DISCORD_LOG_WEBHOOK;
const VOTE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

let cachedClient = null;

async function getDB() {
    if (!cachedClient) {
        cachedClient = await MongoClient.connect(MONGODB_URI);
    }
    return cachedClient.db('votetracker');
}

// Send DM to user via Discord HTTP API
async function sendDM(userId, expiresAt) {
    if (!DISCORD_TOKEN) return;

    try {
        const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipient_id: userId })
        });

        if (!dmRes.ok) {
            console.warn(`⚠️ Could not create DM channel for ${userId}`);
            return;
        }

        const dmChannel = await dmRes.json();
        const expiryUnix = Math.floor(expiresAt / 1000);

        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                embeds: [{
                    color: 0xFFB6C1,
                    title: '✨ Premium Activated!',
                    description:
                        `Thanks for voting! You now have **12 hours** of access to NSFW commands and chat!\n\n` +
                        `⏰ Expires: <t:${expiryUnix}:R>`,
                    footer: { text: '© vqru' },
                    timestamp: new Date().toISOString()
                }]
            })
        });

        console.log(`✅ DM sent to user ${userId}`);
    } catch (error) {
        console.error(`❌ Failed to send DM to ${userId}:`, error.message);
    }
}

// Log vote to Discord channel via webhook URL
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

        console.log(`✅ Logged vote to Discord for ${userId}`);
    } catch (error) {
        console.error(`❌ Failed to log to Discord:`, error.message);
    }
}

// Fetch Discord user info
async function getDiscordUser(userId) {
    if (!DISCORD_TOKEN) return null;

    try {
        const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: { 'Authorization': `Bot ${DISCORD_TOKEN}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = req.headers['authorization'];
    if (TOPGG_WEBHOOK_SECRET && auth !== TOPGG_WEBHOOK_SECRET) {
        console.warn('⚠️ Unauthorized webhook attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Respond immediately so top.gg doesn't timeout
    res.status(200).json({ success: true });

    try {
        const { user, type } = req.body;

        if (type !== 'upvote') return;
        if (!user) return;

        const now = Date.now();
        const expiresAt = now + VOTE_DURATION;

        const db = await getDB();
        const votes = db.collection('votes');
        const existing = await votes.findOne({ userId: user });
        const totalVotes = existing ? (existing.totalVotes || 0) + 1 : 1;

        await votes.updateOne(
            { userId: user },
            {
                $set: {
                    userId: user,
                    lastVoteTime: now,
                    expiresAt,
                    totalVotes,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        // Also save to premium collection for TopGGManager
        await db.collection('premium').updateOne(
            { userId: user },
            {
                $set: {
                    userId: user,
                    premiumUntil: expiresAt,
                    expiredWarnings: 0,
                    lastVoteTimestamp: now,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        console.log(`✅ Vote recorded for ${user} (total: ${totalVotes})`);

        const discordUser = await getDiscordUser(user);
        const username = discordUser ? (discordUser.global_name || discordUser.username) : 'Unknown User';
        const avatar = discordUser ? discordUser.avatar : null;

        await Promise.allSettled([
            sendDM(user, expiresAt),
            logToDiscord(user, username, avatar, now, expiresAt)
        ]);

    } catch (error) {
        console.error('❌ Webhook handler error:', error.message);
    }
};
