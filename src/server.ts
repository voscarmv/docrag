import { DynamicStoreBackend } from '@voscarmv/apigen';
import { textChunks } from './schema.js'; // Your Drizzle schema
import { sql } from 'drizzle-orm';
import OpenAI, { toFile } from 'openai';
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
            dimensions: 384,
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
            dimensions: 384,
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

        console.log("Chunking");
        for (let i = 0; i < text.length; i += chunkSize) {
            console.log(`Chunk index ${i} of ${text.length}`);
            const chunk = text.slice(i, i + chunkSize).trim();
            if (chunk) {
                chunks.push(chunk);
            }
        }

        console.log("Generating request");
        const requests = chunks.map((chunk, i) => {
            console.log(`Processing chunk ${i}/${chunks.length}`);
            return {
                custom_id: `chunk-${i}`,
                method: 'POST',
                url: '/v1/embeddings',
                body: {
                    model: 'text-embedding-3-small',
                    input: chunk,
                    encoding_format: 'float',
                    dimensions: 384
                }
            }
        });

        console.log("Stringify requests")
        const jsonlContent = requests.map((req, i) => {
            console.log(`Sringify request ${i} of ${requests.length}`);
            return JSON.stringify(req);
        }).join('\n');

        // Use toFile helper - more reliable than Blob
        const file = await toFile(
            Buffer.from(jsonlContent),
            'batch_requests.jsonl',
            { type: 'application/jsonl' }
        );
        // Upload the Blob
        const batchFile = await openai.files.create({
            file,
            purpose: 'batch'
        });

        console.log("Creating batch.");
        const batch = await openai.batches.create({
            input_file_id: batchFile.id,
            endpoint: '/v1/embeddings',
            completion_window: '24h'
        });

        let batchresult;
        while (true) {
            batchresult = await openai.batches.retrieve(batch.id);
            console.log(`Status: ${batchresult.status}`);
            if (!batchresult.request_counts) { throw new Error('batchresult.request_counts undefined') }
            console.log(`Progress: ${batchresult.request_counts.completed}/${batchresult.request_counts.total}`);
            if (batchresult.status === 'completed') { break; }
            if (['failed', 'expired', 'cancelled'].includes(batchresult.status)) {
                // console.log(JSON.stringify(batchresult));
                if (!batchresult.errors?.data) { throw new Error(`Batch ${batchresult.status} `) }
                throw new Error(`Batch ${batchresult.status} ${batchresult.errors.data[0]?.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
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

            if (!content) { throw new Error('embeddings[i] is undefined') }
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

BackendDB.route({
    method: 'post',
    path: '/rtbatch',
    handler: async (db, req, res) => {
        if (!req.file) { throw new Error('req.file is undefined') }
        const fileBuffer: Buffer = req.file?.buffer;
        const text = fileBuffer.toString();
        const fileName = req.file.originalname;

        // OpenAI embedding limits:
        // - Max 8192 tokens per individual input
        // - Max 2048 inputs per request
        // - Max 100,000 tokens total across all inputs per request
        // Use character count as safe buffer (worst case: 1 token per char)
        const MAX_CHARS_PER_CHUNK = 8192;
        const MAX_INPUTS_PER_REQUEST = 2048;
        const MAX_CHARS_PER_REQUEST = 100000;
        const MAX_RETRIES = 3;

        console.log(`Max chars per chunk: ${MAX_CHARS_PER_CHUNK}`);

        // Chunk the text
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += MAX_CHARS_PER_CHUNK) {
            const chunk = text.slice(i, i + MAX_CHARS_PER_CHUNK).trim();
            if (chunk) {
                chunks.push(chunk);
            }
        }

        console.log(`Created ${chunks.length} chunks`);

        // Process chunks in batches
        let currentBatch: string[] = [];
        let currentBatchChars = 0;
        let processedChunks = 0;

        const processBatch = async (batch: string[], startIndex: number, retryCount = 0): Promise<void> => {
            try {
                console.log(`Processing batch: ${batch.length} chunks (starting at ${startIndex})`);

                const response = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: batch,
                    encoding_format: 'float',
                    dimensions: 384
                });

                // Insert embeddings
                for (let j = 0; j < batch.length; j++) {
                    const chunkIndex = startIndex + j;
                    const content = batch[j];
                    const embedding = response.data[j]?.embedding;

                    if (!content) { throw new Error('content is undefined'); }
                    await db.insert(textChunks).values({
                        documentId: fileName,
                        chunkIndex,
                        content,
                        embedding,
                    }).returning();

                    console.log(`Inserted chunk ${chunkIndex + 1}/${chunks.length}`);
                }
            } catch (error) {
                if (retryCount < MAX_RETRIES) {
                    console.log(`Batch failed, retry ${retryCount + 1}/${MAX_RETRIES}`);
                    await processBatch(batch, startIndex, retryCount + 1);
                } else {
                    throw new Error(`Batch processing failed after ${MAX_RETRIES} retries: ${error}`);
                }
            }
        };

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) { throw new Error('chunk is undefined') };
            const chunkChars = chunk.length;

            // Check if adding this chunk would exceed limits
            const wouldExceedChars = currentBatchChars + chunkChars > MAX_CHARS_PER_REQUEST;
            const wouldExceedInputs = currentBatch.length >= MAX_INPUTS_PER_REQUEST;

            // Process current batch if we'd exceed limits
            if ((wouldExceedChars || wouldExceedInputs) && currentBatch.length > 0) {
                await processBatch(currentBatch, processedChunks);

                processedChunks += currentBatch.length;
                currentBatch = [];
                currentBatchChars = 0;
            }

            // Add current chunk to batch
            currentBatch.push(chunk);
            currentBatchChars += chunkChars;
        }

        // Process remaining chunks
        if (currentBatch.length > 0) {
            console.log(`Processing final batch: ${currentBatch.length} chunks`);
            await processBatch(currentBatch, processedChunks);
            processedChunks += currentBatch.length;
        }

        console.log(`Completed: Processed ${processedChunks} total chunks`);
        res.status(200).json({
            success: true,
            chunksProcessed: processedChunks
        });
    },
    middlewares: [upload.single('file')]
});

const getEmbedding = async (text: string, retryCount = 0, OLLAMA_URL: string, OLLAMA_MODEL: string, MAX_RETRIES: number, RETRY_DELAY_MS: number): Promise<number[]> => {
    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt: text,
                truncate: true, // Auto-truncate if over 256 tokens
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.embedding;
    } catch (error) {
        if (retryCount < MAX_RETRIES) {
            console.log(`Embedding failed, retry ${retryCount + 1}/${MAX_RETRIES}`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
            return getEmbedding(text, retryCount + 1, OLLAMA_URL, OLLAMA_MODEL, MAX_RETRIES, RETRY_DELAY_MS);
        } else {
            throw new Error(`Embedding failed after ${MAX_RETRIES} retries: ${error}`);
        }
    }
};

// Using Ollama. Install previously with.
// ollama pull all-minilm
// Warning: this is untested.
BackendDB.route({
    method: 'post',
    path: '/local/rtbatch',
    handler: async (db, req, res) => {
        if (!req.file) { throw new Error('req.file is undefined') }
        const fileBuffer: Buffer = req.file?.buffer;
        const text = fileBuffer.toString();
        const fileName = req.file.originalname;

        // Ollama configuration
        const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
        const OLLAMA_MODEL = 'all-minilm';
        // all-minilm limits: 256 tokens max
        // Use 1 char = 1 token worst case to guarantee we stay under limit
        const MAX_CHARS_PER_CHUNK = 256;
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1000;

        console.log(`Max chars per chunk: ${MAX_CHARS_PER_CHUNK}`);

        // Chunk the text
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += MAX_CHARS_PER_CHUNK) {
            const chunk = text.slice(i, i + MAX_CHARS_PER_CHUNK).trim();
            if (chunk) {
                chunks.push(chunk);
            }
        }

        console.log(`Created ${chunks.length} chunks`);

        // Process chunks sequentially (Ollama handles one at a time)
        let processedChunks = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk) { throw new Error('chunk is undefined') };

            try {
                console.log(`Processing chunk ${i + 1}/${chunks.length}`);

                // Get embedding from Ollama
                const embedding = await getEmbedding(chunk, 3, OLLAMA_URL, OLLAMA_MODEL, MAX_RETRIES, RETRY_DELAY_MS);

                // Insert into database
                await db.insert(textChunks).values({
                    documentId: fileName,
                    chunkIndex: i,
                    content: chunk,
                    embedding,
                }).returning();

                processedChunks++;
                console.log(`Inserted chunk ${i + 1}/${chunks.length}`);
            } catch (error) {
                console.error(`Failed to process chunk ${i + 1}:`, error);
                throw new Error(`Chunk ${i + 1} failed: ${error}`);
            }
        }

        console.log(`Completed: Processed ${processedChunks} total chunks`);
        res.status(200).json({
            success: true,
            chunksProcessed: processedChunks
        });
    },
    middlewares: [upload.single('file')]
});

BackendDB.route({
    method: 'get',
    path: '/local/chunks/:input',
    handler: async (db, req, res) => {
        const OLLAMA_URL = 'http://localhost:11434/api/embeddings';
        const OLLAMA_MODEL = 'all-minilm';
        // all-minilm limits: 256 tokens max
        // Use 1 char = 1 token worst case to guarantee we stay under limit
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 1000;
        const { input } = req.params;
        if (!input) {
            throw new Error('embedding input undefined');
        }
        // const { data } = await openai.embeddings.create({
        //     model: 'text-embedding-3-small',
        //     dimensions: 384,
        //     input,
        // });
        const queryEmbedding = await getEmbedding(input, 3, OLLAMA_URL, OLLAMA_MODEL, MAX_RETRIES, RETRY_DELAY_MS);

        // const queryEmbedding: Array<number> = data[0]?.embedding as Array<number>;
        const vectorString = `[${queryEmbedding.join(',')}]`;
        const results = await db
            .select()
            .from(textChunks)
            .orderBy(sql.raw(`embedding <=> '${vectorString}'::vector`))
            .limit(5);
        res.json(results);
    }
});