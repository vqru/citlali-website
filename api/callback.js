const axios = require('axios')
const mongoose = require('mongoose')

const IgAccountSchema = new mongoose.Schema({
	userId: { type: String, unique: true },
	igUserId: String,
	igUsername: String,
	accessToken: String,
	linkedAt: { type: Date, default: Date.now }
})

let IgAccount
try {
	IgAccount = mongoose.model('IgAccount')
} catch {
	IgAccount = mongoose.model('IgAccount', IgAccountSchema)
}

async function connectDb() {
	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(process.env.MONGO_URI)
	}
}

module.exports = async (req, res) => {
	const { code, state } = req.query

	if (!code || !state) return res.status(400).send('Missing params.')

	try {
		await connectDb()

		const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token',
			new URLSearchParams({
				client_id: process.env.META_APP_ID,
				client_secret: process.env.META_APP_SECRET,
				grant_type: 'authorization_code',
				redirect_uri: process.env.OAUTH_REDIRECT_URI,
				code
			}),
			{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
		)

		const { access_token, user_id } = tokenRes.data

		const longRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
			params: {
				grant_type: 'fb_exchange_token',
				client_id: process.env.META_APP_ID,
				client_secret: process.env.META_APP_SECRET,
				fb_exchange_token: access_token
			}
		})

		const longToken = longRes.data.access_token

		const profileRes = await axios.get(`https://graph.facebook.com/v19.0/${user_id}`, {
			params: { fields: 'username', access_token: longToken }
		})

		await IgAccount.findOneAndUpdate(
			{ userId: state },
			{ userId: state, igUserId: String(user_id), igUsername: profileRes.data.username, accessToken: longToken },
			{ upsert: true, new: true }
		)

		res.setHeader('Content-Type', 'text/html')
		res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">Instagram linked successfully! You can close this tab and go back to Discord.</h2>')
	} catch (e) {
		console.error(e?.response?.data ?? e)
		res.status(500).send('Something went wrong. Try again.')
	}
}
