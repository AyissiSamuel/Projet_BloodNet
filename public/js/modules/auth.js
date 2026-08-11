export const checkAuth = (roleRequis = null) => {
    const token = localStorage.getItem('bloodnet_token');
    if (!token) {
        window.location.href = "/login.html";
        return null;
    }

    // Vérification optionnelle du rôle : protège admin.html d'un accès par un
    // compte hôpital, et inversement, même si l'utilisateur force l'URL.
    if (roleRequis) {
        try {
            const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
            if (userInfo.role !== roleRequis) {
                window.location.href = userInfo.role === 'SUPER_ADMIN' ? "/admin.html" : "/index.html";
                return null;
            }
        } catch (e) {
            window.location.href = "/login.html";
            return null;
        }
    }

    return token;
};

export const logout = () => {
    localStorage.clear();
    window.location.href = "/login.html";
};