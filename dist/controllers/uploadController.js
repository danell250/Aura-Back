"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = void 0;
const uploadFile = (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }
    // Construct public URL
    // Assuming the server is running on localhost or similar, adapted to the request host
    const protocol = req.protocol;
    const host = req.get('host');
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    res.json({
        url: fileUrl,
        filename: req.file.filename,
        mimetype: req.file.mimetype
    });
};
exports.uploadFile = uploadFile;
