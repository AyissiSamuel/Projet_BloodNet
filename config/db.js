const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

const poolConfig = process.env.DATABASE_URL 
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        options: "-c search_path=core_identity,medical_logistics,drone_telemetry,public"
      }
    : {
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '', 
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "5432", 10),
        database: process.env.DB_NAME,
        options: "-c search_path=core_identity,medical_logistics,drone_telemetry,public"
      };

const pool = new Pool(poolConfig);

module.exports = {
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
    pool
};