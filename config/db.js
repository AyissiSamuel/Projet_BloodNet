// config/db.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); 

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD ? String(process.env.DB_PASSWORD) : '', 
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME,
    // Permet d'injecter proprement les schémas dès l'ouverture sans déclencher le warning pg@9.0
    options: "-c search_path=core_identity,medical_logistics,drone_telemetry,public"
});

// Uniquement l'exportation brute
module.exports = {
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(), // Nécessaire pour les transactions (BEGIN/COMMIT/ROLLBACK) via un client dédié
    pool
};
