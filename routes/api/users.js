const express = require('express');
const { AuthenticationClient, BIM360Client } = require('forge-server-utils');
const config = require('../../config');
const axios = require('axios').default;

let authClient = new AuthenticationClient(config.client_id, config.client_secret);
let router = express.Router();

function handleError(err, res) {
    console.error(err);
    if (err.isAxiosError) {
        const json = { message: err.message };
        if (err.response.data) {
            json.response = err.response.data;
        }
        res.status(err.response.status).json(json);
    } else {
        res.status(400).json(err);
    }
}

// Parse JSON body
router.use(express.json());

// Refresh token whenever needed
router.use('/', async function (req, res, next) {
    if (req.session.access_token) {
        if (Date.now() > req.session.expires_at) {
            try {
                const token = await authClient.refreshToken(config.scopes, req.session.refresh_token);
                req.session.access_token = token.access_token;
                req.session.refresh_token = token.refresh_token;
                req.session.expires_at = Date.now() + token.expires_in * 1000;
            } catch(err) {
                handleError(err, res);
                return;
            }
        }
        req.bim360 = new BIM360Client({ client_id: config.client_id, client_secret: config.client_secret }, undefined, req.query.region);
        next();
    } else {
        res.status(401).end();
    }
});

// GET /api/users/:project_id
router.get('/:project_id', async function (req, res) {
    const { project_id } = req.params;
    try {
        const users = await loadProjectUsers(project_id);
        res.json(users);
    } catch(err) {
        handleError(err, res);
    }
});

async function loadProjectUsers(projectId) {
    const auth = await authClient.authenticate(['account:read']);
    const PageSize = 64;
    let url = `https://developer.api.autodesk.com/bim360/admin/v1/projects/${projectId}/users?limit=${PageSize}`;
    let opts = {
        headers: {
            'Authorization': `Bearer ${auth.access_token}`
        }
    };
    let response = await axios.get(url, opts);
    let results = response.data.results;
    while (response.data.pagination && response.data.pagination.nextUrl) {
        url = response.data.pagination.nextUrl;
        response = await axios.get(url, opts);
        results = results.concat(response.data.results);
    }
    return results;
}

module.exports = router;
