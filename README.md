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
node dist/cli_query.js "Private versus personal property"
```

This should output chunks which are semantically close to `Private versus personal property` from the Communist Manifesto.

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