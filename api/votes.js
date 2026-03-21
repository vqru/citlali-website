export default async function handler(req, res) {
    try {
        const r = await fetch('http://noel.hidencloud.com:24684/api/votes');
        const data = await r.json();
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
