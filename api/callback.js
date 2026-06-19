const fetch = require('node-fetch')
const mongoose = require('mongoose')

const igAccountSchema = new mongoose.Schema({
	userId:         { type: String, required: true },
	igUserId:       { type: String, required: true },
	igUsername:     { type: String, required: true },
	accessToken:    { type: String, required: true },
	tokenExpiresAt: { type: Date, default: null },
	linkedAt:       { type: Date, default: Date.now }
})
igAccountSchema.index({ userId: 1, igUserId: 1 }, { unique: true })

let IgAccount
try {
	IgAccount = mongoose.model('IgAccount')
} catch {
	IgAccount = mongoose.model('IgAccount', igAccountSchema)
}

async function connectDb() {
	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(process.env.MONGO_URI)
	}
}

function html(title, message, color = '#5865F2') {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;}
.card{background:#1a1a1a;border:1px solid #333;border-radius:16px;padding:48px 40px;max-width:480px;text-align:center;}
h2{color:${color};margin:0 0 12px;}p{color:#aaa;margin:0;line-height:1.6;}</style></head>
<body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`
}

module.exports = async (req, res) => {
	const { code, state, error } = req.query

	if (error) {
		res.setHeader('Content-Type', 'text/html')
		return res.status(400).send(html('Authorization Cancelled', 'You cancelled the Instagram login. You can close this tab and try again from Discord.', '#ED4245'))
	}

	if (!code || !state) {
		res.setHeader('Content-Type', 'text/html')
		return res.status(400).send(html('Invalid Request', 'Missing required parameters. Please try again from Discord.', '#ED4245'))
	}

	try {
		await connectDb()

		// Step 1: exchange code for short-lived token
		const tokenParams = new URLSearchParams({
			client_id:     process.env.META_APP_ID,
			client_secret: process.env.META_APP_SECRET,
			grant_type:    'authorization_code',
			redirect_uri:  process.env.OAUTH_REDIRECT_URI,
			code
		})

		const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
			method: 'POST',
			body:   tokenParams
		})

		const tokenData = await tokenRes.json()
		if (!tokenData.access_token) {
			console.error('[callback] token exchange failed:', tokenData)
			res.setHeader('Content-Type', 'text/html')
			return res.status(500).send(html('Something Went Wrong', 'Could not complete Instagram login. Please try again from Discord.', '#ED4245'))
		}

		const shortLivedToken = tokenData.access_token
		const igUserId        = tokenData.user_id?.toString()

		// Step 2: exchange for long-lived token (60 days)
		const longRes = await fetch(
			`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.META_APP_SECRET}&access_token=${shortLivedToken}`
		)
		const longData = await longRes.json()
		if (!longData.access_token) {
			console.error('[callback] long-lived token exchange failed:', longData)
			res.setHeader('Content-Type', 'text/html')
			return res.status(500).send(html('Something Went Wrong', 'Token exchange failed. Please try again from Discord.', '#ED4245'))
		}

		const accessToken    = longData.access_token
		const expiresIn      = longData.expires_in ?? 5184000
		const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

		// Step 3: fetch username
		const profileRes = await fetch(
			`https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${accessToken}`
		)
		const profileData = await profileRes.json()
		if (!profileData.username) {
			console.error('[callback] profile fetch failed:', profileData)
			res.setHeader('Content-Type', 'text/html')
			return res.status(500).send(html('Something Went Wrong', 'Could not fetch your Instagram profile. Please try again.', '#ED4245'))
		}

		const igUsername       = profileData.username.toLowerCase()
		const resolvedIgUserId = igUserId || profileData.id?.toString()

		// Step 4: upsert — compound unique (userId + igUserId) allows multiple accounts per Discord user
		await IgAccount.findOneAndUpdate(
			{ userId: state, igUserId: resolvedIgUserId },
			{
				userId:         state,
				igUserId:       resolvedIgUserId,
				igUsername,
				accessToken,
				tokenExpiresAt,
				linkedAt:       new Date()
			},
			{ upsert: true, returnDocument: 'after' }
		)

		res.setHeader('Content-Type', 'text/html')
		res.send(html(
			'Instagram Connected!',
			`<strong>@${igUsername}</strong> has been linked to your Discord account.<br><br>You can close this tab and go back to Discord.`,
			'#57F287'
		))

	} catch (e) {
		console.error('[callback] unexpected error:', e)
		res.setHeader('Content-Type', 'text/html')
		res.status(500).send(html('Something Went Wrong', 'An unexpected error occurred. Please try again from Discord.', '#ED4245'))
	}
}
