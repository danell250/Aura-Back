import { Router } from 'express';
import { birthdayController } from '../controllers/birthdayController';

const router = Router();

router.get('/today', birthdayController.getTodayBirthdays);

export default router;

