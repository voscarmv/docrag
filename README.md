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

Then, on another terminal, run

```
node ./dist/cli_batch.js ./src/pg61.txt
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