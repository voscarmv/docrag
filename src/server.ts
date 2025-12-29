import { DynamicStoreBackend } from '@voscarmv/apigen';
import { textChunks } from './schema.js'; // Your Drizzle schema
import { sql } from 'drizzle-orm';
import OpenAI from 'openai';
import "dotenv/config";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Create backend instance
export const BackendDB = new DynamicStoreBackend({
    dbUrl: process.env.DATABASE_URL!,
    port: 3000
});

// Add a public route
BackendDB.route('get', '/chunks/:input', async (db, req, res) => {
    const { input } = req.params;
    if (!input) {
        throw new Error('embedding input undefined');
    }
    const { data } = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input,
    });
    const queryEmbedding: Array<number> = data[0]?.embedding as  Array<number>;
    const vectorString = `[${queryEmbedding.join(',')}]`;
    const results = await db
        .select()
        .from(textChunks)
        .orderBy(sql.raw(`embedding <=> '${vectorString}'::vector`))
        .limit(5);
    res.json(results);
});

BackendDB.route('post', '/chunks', async (db, req, res) => {
    const {
        documentId,
        chunkIndex,
        content,
    } = req.body;
    const { data } = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
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
});
