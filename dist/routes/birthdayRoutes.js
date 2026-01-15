"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const birthdayController_1 = require("../controllers/birthdayController");
const router = (0, express_1.Router)();
router.get('/today', birthdayController_1.birthdayController.getTodayBirthdays);
exports.default = router;
