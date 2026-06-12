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

		const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
			params: {
				client_id: process.env.META_APP_ID,
				client_secret: process.env.META_APP_SECRET,
				redirect_uri: process.env.OAUTH_REDIRECT_URI,
				code
			}
		})

		const accessToken = tokenRes.data.access_token

		const igRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
			params: { access_token: accessToken, fields: 'instagram_business_account' }
		})

		const page = igRes.data.data?.find(p => p.instagram_business_account)
		if (!page) {
			return res.setHeader('Content-Type', 'text/html') && res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">No Instagram Business/Creator account found linked to your Facebook. Please link your Instagram to a Facebook Page first, then try again.</h2>')
		}

		const igId = page.instagram_business_account.id

		const profileRes = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
			params: { fields: 'username', access_token: accessToken }
		})

		await IgAccount.findOneAndUpdate(
			{ userId: state },
			{ userId: state, igUserId: igId, igUsername: profileRes.data.username, accessToken },
			{ upsert: true, new: true }
		)

		res.setHeader('Content-Type', 'text/html')
		res.send('<h2 style="font-family:sans-serif;text-align:center;margin-top:80px">Instagram linked successfully! You can close this tab and go back to Discord.</h2>')
	} catch (e) {
		console.error(e?.response?.data ?? e)
		res.status(500).send('Something went wrong. Try again.')
	}
}
