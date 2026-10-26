import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';

const app = express();
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(express.static('public'));

app.get('/', (_req, res) => {
	res.redirect('/index.html');
});

app.post('/api/analyze', upload.single('image'), async (req, res) => {
	try {
		if (!process.env.GEMINI_API_KEY) {
			return res.status(500).json({ error: 'GEMINI_API_KEY belum diatur.' });
		}
		if (!req.file || !req.file.mimetype.startsWith('image/')) {
			return res.status(400).json({ error: 'Pilih file gambar.' });
		}

		const prompt = 'Analisis foto makanan ini. Jangan mengarang bahan yang tidak terlihat. Perkirakan nutrisi dari porsi yang terlihat dan jawab dalam bahasa Indonesia. Nilai nutrisi adalah estimasi visual, bukan diagnosis.';
		const schema = {
			type: 'object',
			properties: {
				dishName: { type: 'string' },
				components: { type: 'array', items: { type: 'string' } },
				portion: { type: 'string' },
				caloriesMin: { type: 'number' },
				caloriesMax: { type: 'number' },
				proteinMin: { type: 'number' },
				proteinMax: { type: 'number' },
				confidence: { type: 'string', enum: ['rendah', 'sedang', 'tinggi'] },
				notes: { type: 'string' },
			},
			required: [
				'dishName', 'components', 'portion', 'caloriesMin', 'caloriesMax',
				'proteinMin', 'proteinMax', 'confidence', 'notes',
			],
			additionalProperties: false,
		};

		const requestBody = {
			input: [
				{ type: 'text', text: prompt },
				{
					type: 'image',
					data: req.file.buffer.toString('base64'),
					mime_type: req.file.mimetype,
				},
			],
			response_format: {
				type: 'text',
				mime_type: 'application/json',
				schema,
			},
			store: false,
		};
		const models = ['gemini-3.8-flash', 'gemini-3.6-flash'];
		let response;
		let result;
		for (let attempt = 0; attempt < models.length; attempt++) {
			try {
				response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-goog-api-key': process.env.GEMINI_API_KEY,
					},
					body: JSON.stringify({ ...requestBody, model: models[attempt] }),
					timeout: 12000,
				});
				result = await response.json();
				if (response.ok) break;

				const temporary = [429, 500, 502, 503, 504].includes(response.status);
				if (!temporary) {
					const message = result?.error?.message || result?.message || 'Permintaan AI gagal.';
					return res.status(response.status).json({ error: message });
				}
			} catch (error) {
				if (attempt === models.length - 1) {
					return res.status(503).json({ error: 'Gemini terlalu lama merespons. Coba lagi sebentar.' });
				}
			}
			if (attempt === models.length - 1) {
				return res.status(503).json({ error: 'Layanan Gemini sedang ramai. Silakan coba lagi sebentar.' });
			}
		}

		const outputText = result.output_text || result.steps
			?.flatMap(step => step.content || [])
			.filter(part => part.type === 'text')
			.map(part => part.text)
			.join('');
		if (!outputText) throw new Error('AI tidak mengembalikan hasil.');

		res.json(JSON.parse(outputText));
	} catch (error) {
		res.status(500).json({ error: error.message || 'Analisis gagal.' });
	}
});

app.listen(process.env.PORT || 3000, () => {
	console.log('KaloriLens: http://localhost:' + (process.env.PORT || 3000));
});
