const multer = require('multer');
const path = require('path');
const fs = require('fs');

// All uploaded documents (business/ownership docs, driver licenses) land
// in backend/uploads/ on disk, renamed to avoid collisions. Nothing fancy --
// this is enough for documents an admin would later review by hand.
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { upload };
