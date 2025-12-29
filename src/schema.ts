import { index, pgTable, serial, text, vector, integer } from 'drizzle-orm/pg-core';

export const textChunks = pgTable(
  'text_chunks',
  {
    id: serial('id').primaryKey(),
    documentId: text('document_id').notNull(), // To group chunks from same file
    chunkIndex: integer('chunk_index').notNull(), // Order of chunks
    content: text('content').notNull(), // The 500 char chunk
    embedding: vector('embedding', { dimensions: 512 }),
  },
  (table) => [
    index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
    index('documentIndex').on(table.documentId), // For retrieving all chunks of a document
  ]
);