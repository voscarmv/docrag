import { DynamicStoreBackend } from '@voscarmv/apigen';
import { textChunks } from './schema.js'; // Your Drizzle schema
import { sql } from 'drizzle-orm';
import OpenAI from 'openai';
import multer from 'multer';
import "dotenv/config";

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024, // 1 GB limit (be careful with memory limits)
    }
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Create backend instance
export const BackendDB = new DynamicStoreBackend({
    dbUrl: process.env.DATABASE_URL!,
    port: 3000
});

// Add a public route
BackendDB.route({
    method: 'get',
    path: '/chunks/:input',
    handler: async (db, req, res) => {
        const { input } = req.params;
        if (!input) {
            throw new Error('embedding input undefined');
        }
        const { data } = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            dimensions: 512,
            input,
        });
        const queryEmbedding: Array<number> = data[0]?.embedding as Array<number>;
        const vectorString = `[${queryEmbedding.join(',')}]`;
        const results = await db
            .select()
            .from(textChunks)
            .orderBy(sql.raw(`embedding <=> '${vectorString}'::vector`))
            .limit(5);
        res.json(results);
    }
});

BackendDB.route({
    method: 'post',
    path: '/chunks',
    handler: async (db, req, res) => {
        const {
            documentId,
            chunkIndex,
            content,
        } = req.body;
        const { data } = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            dimensions: 512,
            input: content,
        });
        const embedding = data[0]?.embedding;
        const newChunk = await db.insert(textChunks).values({
            documentId,
            chunkIndex,
            content,
            embedding,
        }).returning();
        res.json(newChunk[0]);
    }
});

BackendDB.route({
    method: 'post',
    path: '/batch',
    handler: async (db, req, res) => {
        if (!req.file) { throw new Error('req.file is undefined') }
        const fileBuffer: Buffer = req.file?.buffer;
        const text = fileBuffer.toString();
        const chunkSize = 500;
        const chunks = [];

        for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize).trim();
            if (chunk) {
                chunks.push(chunk);
            }
        }

        const requests = chunks.map((chunk, i) => ({
            custom_id: `chunk-${i}`,
            method: 'POST',
            url: '/v1/embeddings',
            body: {
                model: 'text-embedding-3-small',
                input: chunk,
                encoding_format: 'float'
            }
        }));

        const jsonlContent = requests.map(req => JSON.stringify(req)).join('\n');

        // Create a Blob instead of Buffer
        const blob = new Blob([jsonlContent], { type: 'application/jsonl' });

        // Upload the Blob
        const batchFile = await openai.files.create({
            file: blob,
            purpose: 'batch'
        });

        const batch = await openai.batches.create({
            input_file_id: batchFile.id,
            endpoint: '/v1/embeddings',
            completion_window: '24h'
        });

        let batchresult;
        while (true) {
            batchresult = await openai.batches.retrieve(batch.id);
            if (batchresult.status === 'completed') { break; }
            if (['failed', 'expired', 'cancelled'].includes(batchresult.status)) {
                throw new Error(`Batch ${batch.status}`);
            }
        }
        if (!batchresult.output_file_id) { throw new Error('batchresult.output_file_id undefined') }
        const fileResponse = await openai.files.content(batchresult.output_file_id);
        const fileContents = await fileResponse.text();

        const lines = fileContents.trim().split('\n');
        const embeddings = [];

        for (const line of lines) {
            const result = JSON.parse(line);
            const chunkIndex = parseInt(result.custom_id.split('-')[1]);
            embeddings.push({
                chunkIndex,
                embedding: result.response.body.data[0].embedding
            });
        }

        embeddings.sort((a, b) => a.chunkIndex - b.chunkIndex);

        for (let i = 0; i < chunks.length; i++) {
            const content = chunks[i];
            const embedding = embeddings[i]?.embedding;
            const chunkIndex = i;

            if(!content) {throw new Error('embeddings[i] is undefined')}
            await db.insert(textChunks).values({
                documentId: 'x',
                chunkIndex,
                content,
                embedding,
            }).returning();
            console.log(`Inserted ${i + 1}/${chunks.length} chunks`);
        }

        res.status(200);
    },
    middlewares: [upload.single('file')]
});
