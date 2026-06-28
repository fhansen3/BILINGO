'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/invitations.controller');
const { requireAuth } = require('../middleware/auth');

router.get('/mine', requireAuth, ctrl.listMine);
router.post('/:id/accept', requireAuth, ctrl.accept);
router.post('/:id/decline', requireAuth, ctrl.decline);
router.post('/:id/cancel', requireAuth, ctrl.cancel);

module.exports = router;
