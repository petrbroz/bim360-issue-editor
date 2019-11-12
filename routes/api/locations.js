const express = require('express');
const { AuthenticationClient, BIM360Client } = require('forge-server-utils');
const config = require('../../config');

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
        req.bim360 = new BIM360Client({ token: req.session.access_token }, undefined, req.query.region);
        next();
    } else {
        res.status(401).end();
    }
});

// GET /api/locations/:issue_container
router.get('/:issue_container', async function (req, res) {
    const { issue_container } = req.params;
    let page = null;
    if (req.query.offset || req.query.limit) {
        page = {
            limit: parseInt(req.query.limit) || 64,
            offset: parseInt(req.query.offset) || 0
        };
    }
    try {
        const locations = await req.bim360.listLocationNodes(issue_container, page);
        res.json(locations);
    } catch(err) {
        handleError(err, res);
    }
});

module.exports = router;
