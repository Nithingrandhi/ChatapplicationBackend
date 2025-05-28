const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Simple test route
app.get('/', (req, res) => {
  res.send(' Backend is  Running!');
});

// Start server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});