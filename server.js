const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));
app.use(express.static('uploads'));

const uploadRoute = require('./upload');
app.use('/', uploadRoute);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chatapplicationfrontend.netlify.app/',
    methods: ['GET', 'POST']
  }
});


// MySQL connection
const db=mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL database.');
});

// Signup
app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;

  db.query('SELECT * FROM users WHERE username = ? OR email = ?', [username, email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error' });

    if (results.length > 0) {
      return res.status(409).json({ message: 'Username or email already exists' });
    }

    db.query('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, password], (err) => {
      if (err) return res.status(500).json({ message: 'Database error on insert' });
      res.json({ message: 'Signup successful' });
    });
  });
});


// Login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT id, username, password FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
            console.error('Login DB error:', err); 
            return res.status(500).json({ message: 'Server error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = results[0];

        if (user.password !== password) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        res.json({
            message: 'Login successful',
            username: user.username
        });
    });
});

app.use(express.json());
app.post('/add-friend', (req, res) => {
   console.log('Received /add-friend POST request',req.body);
  const { username, friendUsername } = req.body;

  if (!username || !friendUsername) {
    return res.status(400).json({ message: 'Both username and friendUsername are required' });
  }

  if (username === friendUsername) {
    return res.status(400).json({ message: "You can't add yourself as a friend" });
}
 console.log(`Attempting to find user: '${username}'`);
db.query('SELECT id FROM users WHERE username = ?', [username], (err, userResults) => {
    if (err) {
      console.error('Error finding user:',err);
      return res.status(500).json({ message: 'Database error' });
    }
    console.log(`User query results for '${username}':`,userResults);
    if (userResults.length === 0)
      {
        console.warn(`User query results for '${username}':`, userResults);
        return res.status(404).json({ message: 'User not found' });
      }

    const userId = userResults[0].id;
    db.query('SELECT id FROM users WHERE username = ?', [friendUsername], (err, friendResults) => {
      if (err) 
        {
          console.error('Error finding friend user:', err);
          return res.status(500).json({ message: 'Database error' });
        }
      console.log(`Friend user query results for '${friendUsername}':`,friendResults)
      if (friendResults.length === 0) return res.status(404).json({ message: 'Friend user not found' });

      const friendId = friendResults[0].id;

      db.query(
        'SELECT * FROM friends WHERE user_id = ? AND friend_id = ?',
        [userId, friendId],
        (err, existing) => {
          if (err) return res.status(500).json({ message: 'Database error' });

          if (existing.length > 0) {
            return res.status(400).json({ message: 'Friend already added' });
          }

          db.query(
            'INSERT INTO friends (user_id, friend_id) VALUES (?, ?), (?, ?)',
            [userId, friendId, friendId, userId],
            (err) => {
              if (err) return res.status(500).json({ message: 'Failed to add friend' });

              res.json({ message: 'Friend added successfully' });
            }
          );
        }
      );
    });
  });
});

app.get('/friends/:username', (req, res) => {
    const username = req.params.username; 

    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    db.query('SELECT id FROM users WHERE username = ?', [username], (err, userResults) => {
        if (err) {
            console.error('Database error finding user for friends list:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        if (userResults.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userId = userResults[0].id;
        const query = `
            SELECT u.username AS friendUsername, u.id AS friendId
            FROM friends f
            JOIN users u ON f.friend_id = u.id
            WHERE f.user_id = ?
        `;

        db.query(query, [userId], (err, friends) => {
            if (err) {
                console.error('Database error fetching friends:', err);
                return res.status(500).json({ message: 'Failed to fetch friends' });
            }
            res.json({ friends: friends });
        });
    });
});
app.post('/send-private-message', (req, res) => {
  const sender = req.headers['x-sender'];
  const { receiver, message } = req.body;

  if (!sender || !receiver || !message) {
    return res.status(400).json({ message: 'Missing sender, receiver, or message' });
  }

  const query = `
    INSERT INTO private_messages (sender, receiver, message)
    VALUES (?, ?, ?)
  `;

  db.query(query, [sender, receiver, message], (err, result) => {
    if (err) {
      console.error('Error inserting private message:', err);
      return res.status(500).json({ message: 'Database error' });
    }

    res.status(200).json({ message: 'Message sent successfully' });
  });
});
app.get('/private-messages/:user1Username/:user2Username', (req, res) => {
    const user1Username = req.params.user1Username;
    const user2Username = req.params.user2Username;

    if (!user1Username || !user2Username) {
        return res.status(400).json({ message: 'Both usernames are required' });
    }

    const query = `
        SELECT id, sender, receiver, message AS message_content, timestamp, is_read
        FROM private_messages
        WHERE (sender = ? AND receiver = ?)
           OR (sender = ? AND receiver = ?)
        ORDER BY timestamp ASC;
    `;

    db.query(query, [user1Username, user2Username, user2Username, user1Username], (err, results) => {
        if (err) {
            console.error('Error fetching private messages:', err);
            return res.status(500).json({ message: 'Server error fetching private messages' });
        }
        const updateReadQuery = `
            UPDATE private_messages
            SET is_read = 1
            WHERE receiver = ? AND sender = ? AND is_read = 0;
        `;
        db.query(updateReadQuery, [user1Username, user2Username], (updateErr) => {
            if (updateErr) {
                console.error('Error updating read status:', updateErr);
            }
            res.json({ messages: results });
        });
    });
});
// Create room
app.post("/create-room", (req, res) => {
  const { roomId } = req.body;

  if (!roomId || roomId.trim() === "") {
    return res.status(400).json({ message: "Room name cannot be empty" });
  }

  const trimmedRoom = roomId.trim();
  const query = "INSERT INTO chatrooms (id) VALUES (?)";
  db.query(query, [trimmedRoom], (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ message: "Room already exists" });
      }
      return res.status(500).json({ message: "Database error", error: err });
    }
    res.status(201).json({ message: "Room created successfully" });
  });
});

// Join room
app.post('/join-room', (req, res) => {
  const { roomId } = req.body;

  const sql = 'SELECT * FROM chatrooms WHERE id = ?';
  db.query(sql, [roomId], (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.status(200).json({ message: 'Room joined successfully', roomId });
  });
});

const rooms = {};

io.on('connection', (socket) => {
  console.log("New client connected:", socket.id);

  socket.on('joinRoom', (roomId, username) => {
    console.log(`${username} joined room ${roomId}`);
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    rooms[roomId].push({ id: socket.id, username });

    io.to(roomId).emit('participants', rooms[roomId].map(u => u.username));
    socket.emit('message', { sender: 'System', text: `Welcome to room ${roomId}` });
    socket.to(roomId).emit('message', { sender: 'System', text: `${username} has joined.` });

    socket.data.roomId = roomId;
    socket.data.username = username;
  });

 socket.on('chat-message', ({ roomId, sender, message, type = 'text' }) => {
  console.log(`Received chat-message from ${sender} in room ${roomId}: ${message}`);

  // Save the message to the database
  const insertQuery = `
    INSERT INTO messages (chatroom_id, username, message, type)
    VALUES (?, ?, ?, ?)
  `;
  db.query(insertQuery, [roomId, sender, message, type], (err, result) => {
    if (err) {
      console.error('❌ Error saving message to database:', err);
      return;
    }

    console.log('✅ Message saved with ID:', result.insertId);

    // Now emit the message to all clients in the room
    io.to(roomId).emit('chat-message', {
      id: result.insertId,
      sender,
      message,
      type,
      timestamp: new Date()  // Optionally include timestamp
    });
  });
});

  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('userTyping', username);
  });

  socket.on('stopTyping', ({ roomId, username }) => {
    socket.to(roomId).emit('userStopTyping', username);
  });
  socket.on('leaveRoom', ({ roomId, username }) => {
    console.log(`${username} manually left room ${roomId}`);
    socket.leave(roomId);

    if (rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter(user => user.id !== socket.id);

      io.to(roomId).emit('message', {
        sender: 'System',
        text: `${username} has left the room.`
      });

      io.to(roomId).emit('participants', rooms[roomId].map(user => user.username));

      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }
  });
  socket.on('disconnect', () => {
    console.log("Client disconnected:", socket.id);

    const roomId = socket.data.roomId;
    const username = socket.data.username;

    if (roomId && rooms[roomId]) {
      const index = rooms[roomId].findIndex(user => user.id === socket.id);
      if (index !== -1) {
        rooms[roomId].splice(index, 1);

        io.to(roomId).emit('message', {
          sender: 'System',
          text: `${username} has left the room.`
        });

        io.to(roomId).emit('participants', rooms[roomId].map(user => user.username));

        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
        }
      }
    }
  });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads/'));
  },
  filename: (req, file, cb) => {
    const username = req.body.username;
    const ext = path.extname(file.originalname);
    cb(null, username + ext);
  }
});

const upload = multer({ storage });

// Upload profile photo
app.post('/upload-profile-photo', upload.single('photo'), (req, res) => {
  try {
    const username = req.body.username;
    const filePath = req.file.filename;

    const updateQuery = 'UPDATE users SET profile_photo = ? WHERE username = ?';
    db.query(updateQuery, [filePath, username], (err) => {
      if (err) return res.status(500).json({ message: 'Failed to update profile photo' });
      res.json({ message: 'Profile photo updated successfully', filename: filePath });
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Remove profile photo
app.delete('/remove-profile-photo', (req, res) => {
  const { username } = req.body;

  db.query('SELECT profile_photo FROM users WHERE username = ?', [username], (err, results) => {
    if (err || results.length === 0) {
      return res.status(500).json({ message: 'Error fetching profile photo' });
    }

    const photo = results[0].profile_photo;
    if (photo) {
      const filePath = path.join(__dirname, 'uploads', photo);

      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error deleting file:', err);
        }

        db.query('UPDATE users SET profile_photo = NULL WHERE username = ?', [username], (err) => {
          if (err) return res.status(500).json({ message: 'Failed to clear profile photo in DB' });
          res.json({ message: 'Profile photo removed successfully' });
        });
      });
    } else {
      res.status(404).json({ message: 'No profile photo to remove' });
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Start server
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
