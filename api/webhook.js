// /api/webhook.js — Vercel Serverless Function
// Receives top.gg vote webhooks and saves to MongoDB

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const TOPGG_WEBHOOK_SECRET = process.env.TOPGG_WEBHOOK_SECRET; // Set this in top.gg webhook settings
const VOTE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

let cachedClient = null;

async function getDB() {
    if (!cachedClient) {
        cachedClient = await MongoClient.connect(MONGODB_URI);
    }
    return cachedClient.db('votetracker');
}

module.exports = async function handler(req, res) {
    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Verify webhook secret from top.gg
    const auth = req.headers['authorization'];
    if (TOPGG_WEBHOOK_SECRET && auth !== TOPGG_WEBHOOK_SECRET) {
        console.warn('⚠️ Unauthorized webhook attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { user, bot, type } = req.body;

        // Only process vote events
        if (type !== 'upvote') {
            return res.status(200).json({ message: 'Ignored non-vote event' });
        }

        if (!user) {
            return res.status(400).json({ error: 'Missing user ID' });
        }

        const now = Date.now();
        const expiresAt = now + VOTE_DURATION;

        const db = await getDB();
        const votes = db.collection('votes');

        // Get existing vote record to increment total
        const existing = await votes.findOne({ userId: user });
        const totalVotes = existing ? (existing.totalVotes || 0) + 1 : 1;

        // Upsert vote record
        await votes.updateOne(
            { userId: user },
            {
                $set: {
                    userId: user,
                    lastVoteTime: now,
                    expiresAt: expiresAt,
                    totalVotes: totalVotes,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        console.log(`✅ Vote recorded for user ${user} via webhook (total: ${totalVotes})`);

        return res.status(200).json({ 
            success: true, 
            userId: user,
            expiresAt,
            totalVotes
        });

    } catch (error) {
        console.error('❌ Webhook handler error:', error.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
