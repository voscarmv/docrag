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

This should output records which are semantically close to `Private versus personal property`.