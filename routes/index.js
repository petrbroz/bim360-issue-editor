const express = require('express');
const { AuthenticationClient, BIM360Client } = require('forge-server-utils');
const config = require('../config');

let authClient = new AuthenticationClient(config.client_id, config.client_secret);
let router = express.Router();

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
                res.render('error', { session: req.session, error: err });
                return;
            }
        }
        req.bim360 = new BIM360Client({ token: req.session.access_token }, undefined, req.query.region);
    }
    next();
});

// GET /
router.get('/', async function (req, res) {
    try {
        let hubs = [];
        if (req.bim360) {
            hubs = await req.bim360.listHubs();
            hubs = hubs.filter(hub => hub.id.startsWith('b.'));
        }
        res.render('hubs', { session: req.session, hubs, client_id: config.client_id, app_name: config.app_name });
    } catch(err) {
        res.render('error', { session: req.session, error: err });
    }
});

// GET /:hub
router.get('/:hub', async function (req, res) {
    try {
        let hub, projects = [];
        if (req.bim360) {
            hub = await req.bim360.getHubDetails(req.params.hub);
            projects = await req.bim360.listProjects(req.params.hub);
        }
        res.render('projects', { session: req.session, hub, projects });
    } catch(err) {
        res.render('error', { session: req.session, error: err });
    }
});

// GET /:hub/:project
router.get('/:hub/:project', async function (req, res) {
    try {
        let hub, project, issueContainer, locationContainer;
        if (req.bim360) {
            hub = await req.bim360.getHubDetails(req.params.hub);
            project = await req.bim360.getProjectDetails(req.params.hub, req.params.project);
            issueContainer = await req.bim360.getIssueContainerID(req.params.hub, req.params.project);
            locationContainer = await req.bim360.getLocationContainerID(req.params.hub, req.params.project);
        }
        res.render('issues', {
            session: req.session,
            hub: hub,
            project,
            issueContainer,
            locationContainer,
            account: req.params.hub.replace('b.', '')
        });
    } catch(err) {
        res.render('error', { session: req.session, error: err });
    }
});

module.exports = router;
