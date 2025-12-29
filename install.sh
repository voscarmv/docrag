#!/bin/bash

## Install postgresql

if grep -e 'DATABASE_URL=' ./.env ; then
    echo "DB found in .env"
    exit
fi

sudo apt install -y postgresql postgresql-contrib postgresql-16-pgvector

read -p "Postgres username: " PGUSER
read -s -p "Postgres password: " PASS
echo
read -p "Database name: " DB

sudo -u postgres psql <<EOF
CREATE DATABASE $DB;
CREATE USER $PGUSER WITH PASSWORD '$PASS';
GRANT ALL PRIVILEGES ON DATABASE $DB TO $PGUSER;
\c $DB;
CREATE EXTENSION vector;
GRANT ALL ON SCHEMA public TO $PGUSER;
EOF

echo "DATABASE_URL=postgres://$PGUSER:$PASS@localhost/$DB" >> .env
echo "✅ Database, user, and .env file created. Edit .env if needed."
