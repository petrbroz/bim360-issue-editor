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
        req.bim360 = new BIM360Client({ client_id: config.client_id, client_secret: config.client_secret }, undefined, req.query.region);
        next();
    } else {
        res.status(401).end();
    }
});

// GET /api/account/:hub/users
router.get('/:account/users', async function (req, res) {
    const { account } = req.params;
    try {
        let filter = {
            partial: true // Perform a fuzzy search
        };
        if (req.query.name) {
            filter.name = req.query.name;
        }
        if (req.query.email) {
            filter.email = req.query.email;
        }
        if (req.query.company_name) {
            filter.company_name = req.query.company_name;
        }
        if (req.query.operator) {
            filter.operator = req.query.operator;
        }
        const users = await req.bim360.listUsers(account, filter);
        res.json(users);
    } catch(err) {
        handleError(err, res);
    }
});

module.exports = router;
