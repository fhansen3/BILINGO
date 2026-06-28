'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/users.controller');
const { requireAuth } = require('../middleware/auth');

router.put('/me', requireAuth, ctrl.updateMe);
router.get('/partners', requireAuth, ctrl.listPartners);
router.get('/:id', requireAuth, ctrl.getPublic);

module.exports = router;
