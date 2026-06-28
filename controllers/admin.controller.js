'use strict';

const adminService = require('../services/admin.service');

async function stats(req, res, next) {
  try { res.json(await adminService.getStats()); } catch (err) { next(err); }
}
async function listUsers(req, res, next) {
  try {
    res.json(await adminService.listUsers({ search: req.query.search, status: req.query.status }));
  } catch (err) { next(err); }
}
async function updateUserStatus(req, res, next) {
  try {
    res.json(await adminService.updateUserStatus(parseInt(req.params.id, 10), req.body.status));
  } catch (err) { next(err); }
}
async function listReports(req, res, next) {
  try { res.json(await adminService.listReports()); } catch (err) { next(err); }
}
async function updateReport(req, res, next) {
  try {
    res.json(await adminService.updateReport(parseInt(req.params.id, 10), req.body.status));
  } catch (err) { next(err); }
}
async function listRooms(req, res, next) {
  try { res.json(await adminService.listRooms()); } catch (err) { next(err); }
}
async function createReport(req, res, next) {
  try {
    const r = await adminService.createReport({
      reporterId: req.user.id,
      reportedUserId: req.body.reportedUserId,
      roomId: req.body.roomId,
      reason: req.body.reason,
      details: req.body.details
    });
    res.json(r);
  } catch (err) { next(err); }
}

module.exports = { stats, listUsers, updateUserStatus, listReports, updateReport, listRooms, createReport };
