import { Request, Response } from 'express';

export const uploadFile = (req: Request, res: Response) => {
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
