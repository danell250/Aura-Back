"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dataExportController_1 = require("../controllers/dataExportController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const router = (0, express_1.Router)();
// GET /api/data-export/request/:userId - Request data export (requires auth + ownership)
router.get('/request/:userId', authMiddleware_1.requireAuth, (0, authMiddleware_1.requireOwnership)('userId'), dataExportController_1.dataExportController.requestDataExport);
// GET /api/data-export/download/:exportId - Download exported data (public with valid export ID)
router.get('/download/:exportId', dataExportController_1.dataExportController.downloadDataExport);
// GET /api/data-export/status/:exportId - Check export status (public with valid export ID)
router.get('/status/:exportId', dataExportController_1.dataExportController.getExportStatus);
// DELETE /api/data-export/:exportId - Delete export data (requires auth)
router.delete('/:exportId', authMiddleware_1.requireAuth, dataExportController_1.dataExportController.deleteExport);
exports.default = router;
