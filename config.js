const { FORGE_APP_NAME, FORGE_CLIENT_ID, FORGE_CLIENT_SECRET, HOST_URL } = process.env;

module.exports = {
    app_name: FORGE_APP_NAME,
    client_id: FORGE_CLIENT_ID,
    client_secret: FORGE_CLIENT_SECRET,
    host_url: HOST_URL,
    scopes: ['viewables:read', 'bucket:create', 'bucket:read', 'data:read', 'data:create', 'data:write'],
    redirect_uri: `${HOST_URL}/auth/callback`
};
