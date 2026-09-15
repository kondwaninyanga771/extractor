const express = require('express');
const cors = require('cors');
const AWS = require('aws-sdk');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configure AWS SDK for Cloudflare R2
const s3 = new AWS.S3({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY,
  secretAccessKey: process.env.R2_SECRET_KEY,
  signatureVersion: 'v4',
});

const BUCKET_NAME = process.env.R2_BUCKET;
const MAX_EXTRACT_SIZE = 2 * 1024 * 1024 * 1024; // 2GB limit

async function downloadFromS3(s3Key, destPath) {
  const params = { Bucket: BUCKET_NAME, Key: s3Key };
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    s3.getObject(params).createReadStream()
      .on('error', reject)
      .pipe(file)
      .on('close', resolve);
  });
}

async function uploadToS3(filePath, s3Key, mimeType) {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: mimeType,
    ACL: 'public-read' // R2 typically ignores this, but safe to include
  };
  return s3.upload(params).promise();
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp'
  };
  return mimes[ext] || 'application/octet-stream';
}

function extractArchive(archivePath, extractDir, isRar = false) {
  return new Promise((resolve, reject) => {
    // 7z handles zip, cbz, epub, cb7. unrar handles rar, cbr
    let cmd = '';
    if (isRar) {
      cmd = `unrar e -y "${archivePath}" "${extractDir}/"`;
    } else {
      cmd = `7z e -y "${archivePath}" -o"${extractDir}"`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error && error.code !== 1) { // 1 is non-fatal warning in some extractors
        console.error(`Extraction error: ${stderr}`);
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

app.post('/extract', async (req, res) => {
  const { s3Key, chapterId, type = 'comics' } = req.body;

  if (!s3Key || !chapterId) {
    return res.status(400).json({ error: 'Missing s3Key or chapterId' });
  }

  // Acknowledge immediately so PHP doesn't wait (Fire and Forget)
  res.json({ message: 'Extraction job started in the background.' });

  console.log(`Starting extraction for Chapter ${chapterId} from S3 Key: ${s3Key}`);

  const tempId = uuidv4();
  const tempArchive = path.join(os.tmpdir(), `${tempId}_archive`);
  const tempExtractDir = path.join(os.tmpdir(), `${tempId}_ext`);

  try {
    // 1. Download Archive
    console.log(`Downloading ${s3Key}...`);
    await downloadFromS3(s3Key, tempArchive);

    // 2. Make extract dir
    if (!fs.existsSync(tempExtractDir)) {
      fs.mkdirSync(tempExtractDir);
    }

    // 3. Extract
    const ext = path.extname(s3Key).toLowerCase();
    const isRar = (ext === '.cbr' || ext === '.rar');
    
    console.log(`Extracting (isRar: ${isRar})...`);
    await extractArchive(tempArchive, tempExtractDir, isRar);

    // 4. Upload Extracted Images
    console.log(`Uploading images to S3...`);
    const files = fs.readdirSync(tempExtractDir);
    let uploadedCount = 0;

    for (const file of files) {
      const filePath = path.join(tempExtractDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isFile()) {
        const mime = getMimeType(filePath);
        if (mime.startsWith('image/')) {
          // Format output S3 Key: assets/documents/comics/extracted/{chapter_id}/filename.ext
          const destKey = `assets/documents/${type}/extracted/${chapterId}/${file}`;
          await uploadToS3(filePath, destKey, mime);
          uploadedCount++;
        }
      }
    }

    console.log(`Successfully extracted and uploaded ${uploadedCount} images for Chapter ${chapterId}!`);

  } catch (err) {
    console.error(`Failed to process extraction for Chapter ${chapterId}:`, err);
  } finally {
    // 5. Cleanup
    try {
      if (fs.existsSync(tempArchive)) fs.unlinkSync(tempArchive);
      if (fs.existsSync(tempExtractDir)) {
        fs.readdirSync(tempExtractDir).forEach(f => fs.unlinkSync(path.join(tempExtractDir, f)));
        fs.rmdirSync(tempExtractDir);
      }
    } catch (cleanupErr) {
      console.error('Failed to cleanup temp files:', cleanupErr);
    }
  }
});

app.get('/health', (req, res) => {
  res.send('Extraction Worker is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Komix Buk Extraction Worker listening on port ${PORT}`);
});
