export const checkAuth = () => {
    const token = localStorage.getItem('bloodnet_token');
    if (!token) {
        window.location.href = "/login.html";
        return null;
    }
    return token;
};

export const logout = () => {
    localStorage.clear();
    window.location.href = "/login.html";
};