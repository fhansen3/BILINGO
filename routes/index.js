'use strict';

const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/rooms', require('./rooms.routes'));
router.use('/invitations', require('./invitations.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/realtime', require('./realtime.routes'));

module.exports = router;
