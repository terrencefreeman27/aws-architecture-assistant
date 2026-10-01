import express from 'express';

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
const port = Number(process.env.API_PORT ?? 4080);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
