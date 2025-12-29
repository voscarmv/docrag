# docrag

pgvector RAG backend 

## Installation and usage

```bash
npm install
npm run build
npm run db:generate
npx dbinstall
npx migrate --dburl postgres://yourusername:yourpassword@yourhost/yourdbname
npm run start
```

Then, on another terminal, run

```
node dist/cli_embed.js
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
npx migrate --dburl postgres://yourusername:yourpassword@yourhost/yourdbname
```