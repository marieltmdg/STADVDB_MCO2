require('dotenv').config();
const express = require('express');
const cors = require('cors');
const moviesRoutes = require('./routes/movies');
const Movie = require('./models/movie');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database connections
Movie.initialize()
  .then(() => console.log('[INFO] Database connections ready'))
  .catch(err => {
    console.error('[ERROR] Failed to initialize database:', err.message);
    // Don't exit - let the server run anyway for testing
  });

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[INFO] Shutting down gracefully...');
  await Movie.cleanup();
  process.exit(0);
});

// Middleware
app.use(cors({
  origin: 'http://localhost:10000' || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/movies', moviesRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`[INFO] Backend server running on port ${PORT}`);
});

module.exports = app;