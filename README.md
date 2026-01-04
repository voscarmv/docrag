# docrag

pgvector RAG backend 

## Installation and usage

```bash
npx dbinstall
npm install
npm run build
npm run db:generate
npm run db:migrate
npm run start
```

Then, on another terminal, run either of these to embed your text

```bash
node ./dist/cli_batch.js ./src/pg61.txt # Single file batch, has a queue limit of 3M tokens
node ./dist/cli_rtbatch.js ./src/pg61.txt # Single file, no queue (real-time embedding), 1M TPM limit for OpenAI Tier 1 usage
node ./dist/cli_embed.js ./src/pg61.txt # Chunk by chunk, slow, 1M TPM
```

Now you can do semantic search, e.g.

```bash
node ./dist/cli_query.js "Private versus personal property"
```

This should output chunks which are semantically close to `Private versus personal property` from the Communist Manifesto.

Alternatively if you have `ollama` with `all-minilm` and `qwen2.5:1.5B` running on `localhost:11434`, you may use

```bash
node ./dist/cli_local_rtbatch.js ./src/pg61.txt
node ./dist/cli_local_query.js "Private versus personal property"
```

This will generate a proper RAG response with `qwen2.5:1.5B`

## Semantic Distance Visualization

![Semantic Distance Plot](./image.png)

This plot shows the cosine distance between a pivot text chunk (46576) and 200 surrounding chunks (±100). The purple area represents raw distances, while the orange rolling average reveals sustained semantic shifts. Lower distances indicate similar content; the green median line helps identify where the document diverges from typical similarity. Notable spikes suggest topic boundaries or narrative shifts in the text.

This can help efficiently identify consecutive neighboring chunks around a pivot that contain a common semantic theme, especially in raw text that is not previously sectioned or that has no metadata to clearly identify semantif shifts. See `src/cli_recursive_query.ts`

## To reset DB

Delete `DATABASE_URL` from `.env`, then

```
sudo -u postgres psql
postgres=# drop database yourdbname;
CTRL-d
```

And then just

``` bash
npx dbinstall
npm run db:migrate
```