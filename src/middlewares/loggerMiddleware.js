const actionLogger = (req, res, next) => {
    // Intercepter la fin de la réponse pour connaître le statut final (200, 400, 500...)
    res.on('finish', () => {
        const userId = req.user ? (req.user.id_utilisateur || req.user.id) : 'Anonyme';
        const userRole = req.user ? req.user.role : 'N/A';
        const method = req.method;
        const url = req.originalUrl;
        const status = res.statusCode;

        console.log(`[LOG] [${new Date().toISOString()}] User: ${userId} (${userRole}) | Action: ${method} ${url} | Status: ${status}`);
    });

    next();
};

module.exports = actionLogger;