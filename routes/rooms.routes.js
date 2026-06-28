'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/rooms.controller');
const { requireAuth } = require('../middleware/auth');

router.post('/', requireAuth, ctrl.create);
router.get('/mine', requireAuth, ctrl.listMine);
router.get('/:code', requireAuth, ctrl.getByCode);
router.post('/:code/join', requireAuth, ctrl.join);
router.post('/:id/end', requireAuth, ctrl.end);
router.get('/:id/messages', requireAuth, ctrl.getMessages);

module.exports = router;
