'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/admin.controller');
const { requireAuth, requireRole } = require('../middleware/auth');

router.post('/reports', requireAuth, ctrl.createReport);

router.use(requireAuth, requireRole('admin'));

router.get('/stats', ctrl.stats);
router.get('/users', ctrl.listUsers);
router.put('/users/:id/status', ctrl.updateUserStatus);
router.get('/rooms', ctrl.listRooms);
router.get('/reports', ctrl.listReports);
router.put('/reports/:id', ctrl.updateReport);

module.exports = router;
