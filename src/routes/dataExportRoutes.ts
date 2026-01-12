import { Router } from 'express';
import { dataExportController } from '../controllers/dataExportController';
import { requireAuth, requireOwnership } from '../middleware/authMiddleware';

const router = Router();

// GET /api/data-export/request/:userId - Request data export (requires auth + ownership)
router.get('/request/:userId', requireAuth, requireOwnership('userId'), dataExportController.requestDataExport);

// GET /api/data-export/download/:exportId - Download exported data (public with valid export ID)
router.get('/download/:exportId', dataExportController.downloadDataExport);

// GET /api/data-export/status/:exportId - Check export status (public with valid export ID)
router.get('/status/:exportId', dataExportController.getExportStatus);

// DELETE /api/data-export/:exportId - Delete export data (requires auth)
router.delete('/:exportId', requireAuth, dataExportController.deleteExport);

export default router;