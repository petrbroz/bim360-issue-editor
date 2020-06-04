const fs = require('fs');
const os = require('os');
const path = require('path');
const spawn = require('child_process').spawn;
const express = require('express');
const { AuthenticationClient, BIM360Client } = require('forge-server-utils');
const axios = require('axios').default;
const multer = require('multer');
const mail = require('@sendgrid/mail');
const upload = multer({ dest: 'uploads/' });

const config = require('../../config');
const { exportIssues, importIssues } = require('../../helpers/excel');

mail.setApiKey(config.sendgrid_key);
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
            } catch (err) {
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

// GET /api/issues/:issue_container
router.get('/:issue_container', async function (req, res) {
    const { issue_container } = req.params;
    try {
        let filter = {};
        if (req.query.owner) {
            filter.owner = req.query.owner;
        }
        if (req.query.due_date) {
            filter.due_date = new Date(req.query.due_date);
        }
        if (req.query.synced_after) {
            filter.synced_after = new Date(req.query.synced_after);
        }
        if (req.query.created_at) {
            filter.created_at = req.query.created_at;
        }
        if (req.query.created_by) {
            filter.created_by = req.query.created_by;
        }
        if (req.query.ng_issue_type_id) {
            filter.ng_issue_type_id = req.query.ng_issue_type_id;
        }
        if (req.query.ng_issue_subtype_id) {
            filter.ng_issue_subtype_id = req.query.ng_issue_subtype_id;
        }
        let page = null;
        if (req.query.offset || req.query.limit) {
            page = {
                limit: parseInt(req.query.limit) || 64,
                offset: parseInt(req.query.offset) || 0
            };
        }

        const issues = await req.bim360.listIssues(issue_container, filter, page);
        res.json(issues);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/export
router.get('/:issue_container/export', async function (req, res) {
    const { issue_container } = req.params;
    const { hub_id, region, location_container_id, project_id, offset, limit } = req.query;
    try {
        const twoLeggedToken = await authClient.authenticate(['data:read', 'data:write', 'data:create', 'account:read']);
        const excel = await exportIssues({
            two_legged_token: twoLeggedToken.access_token,
            three_legged_token: req.session.access_token,
            region: region,
            hub_id: hub_id,
            issue_container_id: issue_container,
            location_container_id: location_container_id,
            project_id: project_id,
            page_offset: offset,
            page_limit: limit
        });
        res.type('.xlsx').send(excel);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/export-email
router.get('/:issue_container/export-email', async function (req, res) {
    const { issue_container } = req.params;
    const { hub_id, region, location_container_id, project_id } = req.query;
    const { user_email } = req.session;
    try {
        const twoLeggedToken = await authClient.authenticate(['data:read', 'data:write', 'data:create', 'account:read']);
        if (user_email) {
            exportIssues({
                two_legged_token: twoLeggedToken.access_token,
                three_legged_token: req.session.access_token,
                region: region,
                hub_id: hub_id,
                issue_container_id: issue_container,
                location_container_id: location_container_id,
                project_id: project_id
            }).then(excel => {
                const msg = {
                    to: user_email,
                    from: 'petr.broz@autodesk.com',
                    subject: 'Exported BIM360 Issues',
                    text: 'Attached you will find the BIM360 issues exported from http://bim360-issue-editor.herokuapp.com.',
                    attachments: [
                        {
                            content: excel.toString('base64'),
                            filename: 'issues.xlsx',
                            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            disposition: 'attachment'
                        }
                    ]
                };
                return mail.send(msg);
            }).then(resp => {
                console.log('SendGrid response', resp);
            }).catch(err => {
                throw err;
            });
            res.render('message', { session: req.session, message: `Issues will be exported and emailed to ${user_email}.` });
        } else {
            res.render('error', { session: req.session, error: `E-mail address not available or not verified.` });
        }
    } catch (err) {
        handleError(err, res);
    }
});

// POST /api/issues/:issue_container/import
router.post('/:issue_container/import', upload.single('xlsx'), async function (req, res) {
    const { issue_container } = req.params;
    const xlsx = fs.readFileSync(req.file.path);
    try {
        const results = await importIssues(xlsx, issue_container, req.session.access_token);
        res.json(results);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/config.json.zip
// Returns password-protected archive with configuration for the command-line tools available in this project.
router.get('/:issue_container/config.json.zip', async function (req, res) {
    const { issue_container } = req.params;
    const { hub_id, region, location_container_id, project_id } = req.query;
    try {
        // Refresh the 3-legged token to make sure the user gets one "as fresh as possible"
        const token = await authClient.refreshToken(config.scopes, req.session.refresh_token);
        req.session.access_token = token.access_token;
        req.session.refresh_token = token.refresh_token;
        req.session.expires_at = Date.now() + token.expires_in * 1000;

        // Get a fresh 2-legged token as well
        const twoLeggedToken = await authClient.authenticate(['data:read', 'data:write', 'data:create', 'account:read']);

        // Pack everything into a password-protected zip
        const cfg = JSON.stringify({
            created_at: new Date().toISOString(),
            expires_at: new Date(req.session.expires_at).toISOString(),
            two_legged_token: twoLeggedToken.access_token,
            three_legged_token: req.session.access_token,
            region: region,
            hub_id: hub_id,
            issue_container_id: issue_container,
            location_container_id: location_container_id,
            project_id: project_id
        }, null, 4);
        const tmpDir = path.resolve(os.tmpdir(), issue_container);
        const jsonPath = path.join(tmpDir, 'config.json');
        const zipPath = path.join(tmpDir, 'config.zip');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
        }
        fs.writeFileSync(jsonPath, cfg);
        const zip = spawn('zip', ['-P', process.env.CLI_CONFIG_PASSWORD, 'config.zip', 'config.json'], { cwd: tmpDir });
        zip.on('exit', function (code) {
            if (code !== 0) {
                handleError('Could not compress the config file.', res);
                return;
            }
            res.sendFile(zipPath, function (err) {
                if (err) {
                    handleError(err, res);
                }
                fs.unlinkSync(jsonPath);
                fs.unlinkSync(zipPath);
            });
        });
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/root-causes
router.get('/:issue_container/root-causes', async function (req, res) {
    const { issue_container } = req.params;
    try {
        const rootCauses = await req.bim360.listIssueRootCauses(issue_container);
        res.json(rootCauses);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/issue-types
router.get('/:issue_container/issue-types', async function (req, res) {
    const { issue_container } = req.params;
    try {
        const issueTypes = await req.bim360.listIssueTypes(issue_container, true);
        res.json(issueTypes);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/attr-definitions
router.get('/:issue_container/attr-definitions', async function (req, res) {
    const { issue_container } = req.params;
    try {
        const attrDefinitions = await req.bim360.listIssueAttributeDefinitions(issue_container);
        res.json(attrDefinitions);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/attr-mappings
router.get('/:issue_container/attr-mappings', async function (req, res) {
    const { issue_container } = req.params;
    try {
        const attrMappings = await req.bim360.listIssueAttributeMappings(issue_container);
        res.json(attrMappings);
    } catch (err) {
        handleError(err, res);
    }
});

// PATCH /api/issues/:issue_container/:issue
router.patch('/:issue_container/:issue', async function (req, res) {
    const { issue_container, issue } = req.params;
    try {
        const attrs = req.body;
        const updatedIssue = await req.bim360.updateIssue(issue_container, issue, attrs);
        res.json(updatedIssue);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/:issue/comments
router.get('/:issue_container/:issue/comments', async function (req, res) {
    const { issue_container, issue } = req.params;
    try {
        const comments = await req.bim360.listIssueComments(issue_container, issue);
        res.json(comments);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/:issue/attachments
router.get('/:issue_container/:issue/attachments', async function (req, res) {
    const { issue_container, issue } = req.params;
    try {
        const attachments = await req.bim360.listIssueAttachments(issue_container, issue);
        res.json(attachments);
    } catch (err) {
        handleError(err, res);
    }
});

// GET /api/issues/:issue_container/:issue/attachments/:id
router.get('/:issue_container/:issue/attachments/:id', async function (req, res) {
    const { issue_container, issue, id } = req.params;
    try {
        const attachments = await req.bim360.listIssueAttachments(issue_container, issue);
        const match = attachments.find(attachment => attachment.id === id);
        if (match) {
            const options = {
                responseType: 'arraybuffer',
                headers: {
                    'Authorization': 'Bearer ' + req.session.access_token
                }
            };
            const response = await axios.get(match.url, options);
            const extension = match.url.substr(match.url.lastIndexOf('.'));
            res.type(extension).send(response.data);
        } else {
            res.status(404).end();
        }
    } catch (err) {
        handleError(err, res);
    }
});

module.exports = router;
