require('dotenv').config();
const express = require('express');
const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const router = express.Router();

const s3Client = new S3Client({
 region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const bucketName='chat-app-uploads-nithingrandhi'
const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: bucketName,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const filename = Date.now().toString() + '-' + file.originalname;
      cb(null, filename);
    }
  })
});

router.post('/upload', upload.single('file'), (req, res) => {

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileKey = req.file.key;
    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
  res.json({
    message: 'File uploaded successfully!',
    fileUrl
  });
}catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
