const { replicateToNodes } = require('./server/src/replication');
// Fragmentation middleware
function fragmentationCheck(req, res, next) {
  const nodeId = process.env.NODE_ID;
  let id = req.body.id || req.params.id;
  if (!id) return next();
  const isEven = parseInt(id) % 2 === 0;
  if (nodeId === 'node2' && !isEven) {
    return res.status(403).send('Node 2 only allows even-numbered id.');
  }
  if (nodeId === 'node3' && isEven) {
    return res.status(403).send('Node 3 only allows odd-numbered id.');
  }
  next();
}
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const expressLayouts = require('express-ejs-layouts');
const Movie = require('./server/src/models/movie');
const {
  IsolationLevel,
  acquireLock,
  releaseLock,
  getLocks
} = require('./server/src/concurrency');

const app = express();
const PORT = process.env.PORT || 3000;

// Database pools are initialized automatically in the Movie model
console.log('[INFO] Database pools initialized for Google Cloud SQL');

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[INFO] Shutting down gracefully...');
  await Movie.cleanup();
  process.exit(0);
});


// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Concurrency control middleware
app.use((req, res, next) => {
  // Set isolation level from query or default
  req.isolationLevel = req.query.isolation || IsolationLevel.READ_COMMITTED;
  next();
});

// Serve static files from client/public
app.use(express.static(path.join(__dirname, 'client', 'public')));

// Set up EJS view engine with layouts
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'client', 'views'));
app.set('layout', 'layout');

// API Routes
app.use('/api/movies', require('./server/src/routes/movies'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});



// Web Interface Routes
// Home page - redirect to movies
app.get('/', (req, res) => {
  res.redirect('/movies');
});

// Movies list page
app.get('/movies', async (req, res) => {
  try {
    const movies = await Movie.getAll(50); // Get first 50 movies
    res.render('movies/index', { 
      movies: movies,
      title: 'Movies Database',
      message: req.query.message,
      searchQuery: {} // Always pass searchQuery
    });
  } catch (error) {
    console.error('Error loading movies:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// New movie form
app.get('/movies/new', (req, res) => {
  console.log('[DEBUG] /movies/new route hit');
  res.render('movies/new', { title: 'Add New Movie' });
});

// Individual movie page
app.get('/movies/:id', fragmentationCheck, async (req, res) => {
  const txId = Date.now() + Math.random();
  const id = req.params.id;
  // Debug: show which node is accessed
  console.log(`[DEBUG] Node ${process.env.NODE_ID} accessed for read: id=${id}`);
  // Acquire read lock
  if (!acquireLock(id, 'read', txId)) {
    return res.status(423).send('Resource is locked. Try again later.');
  }
  try {
    const movie = await Movie.getById(id);
    if (!movie) {
      releaseLock(id, txId);
      return res.status(404).render('404', { title: 'Movie Not Found' });
    }
    res.render('movies/show', { 
      movie: movie,
      title: movie.primaryTitle 
    });
  } catch (error) {
    console.error('Error loading movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  } finally {
    releaseLock(id, txId);
  }
});

// Create movie
app.post('/movies', fragmentationCheck, async (req, res) => {
  const txId = Date.now() + Math.random();
  // Acquire write lock (no id yet, so skip lock)
  try {
    const movieData = {
      titleType: req.body.titleType,
      primaryTitle: req.body.primaryTitle,
      originalTitle: req.body.originalTitle,
      isAdult: req.body.isAdult === 'on',
      startYear: req.body.startYear ? parseInt(req.body.startYear) : null,
      endYear: req.body.endYear ? parseInt(req.body.endYear) : null,
      runtimeMinutes: req.body.runtimeMinutes ? parseInt(req.body.runtimeMinutes) : null,
      genres: req.body.genres
    };
    const created = await Movie.create(movieData);
    // Replicate to other nodes
    replicateToNodes('create', created.id, created);
    res.redirect('/movies?message=Movie created successfully');
  } catch (error) {
    console.error('Error creating movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// Edit movie form
app.get('/movies/:id/edit', async (req, res) => {
  try {
    const movie = await Movie.getById(req.params.id);
    if (!movie) {
      return res.status(404).render('404', { title: 'Movie Not Found' });
    }
    res.render('movies/edit', { 
      movie: movie,
      title: `Edit ${movie.primaryTitle}` 
    });
  } catch (error) {
    console.error('Error loading movie for edit:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// Update movie
app.post('/movies/:id', fragmentationCheck, async (req, res) => {
  const txId = Date.now() + Math.random();
  const id = req.params.id;
  // Acquire write lock
  if (!acquireLock(id, 'write', txId)) {
    return res.status(423).send('Resource is locked. Try again later.');
  }
  try {
    const updateData = {
      titleType: req.body.titleType,
      primaryTitle: req.body.primaryTitle,
      originalTitle: req.body.originalTitle,
      isAdult: req.body.isAdult === 'on',
      startYear: req.body.startYear ? parseInt(req.body.startYear) : null,
      endYear: req.body.endYear ? parseInt(req.body.endYear) : null,
      runtimeMinutes: req.body.runtimeMinutes ? parseInt(req.body.runtimeMinutes) : null,
      genres: req.body.genres
    };
    await Movie.update(id, updateData);
    // Replicate to other nodes
    replicateToNodes('update', id, updateData);
    res.redirect(`/movies/${id}?message=Movie updated successfully`);
  } catch (error) {
    console.error('Error updating movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  } finally {
    releaseLock(id, txId);
  }
});

// Delete movie
app.post('/movies/:id/delete', fragmentationCheck, async (req, res) => {
  const txId = Date.now() + Math.random();
  const id = req.params.id;
  // Acquire write lock
  if (!acquireLock(id, 'write', txId)) {
    return res.status(423).send('Resource is locked. Try again later.');
  }
  try {
    await Movie.delete(id);
    // Replicate to other nodes
    replicateToNodes('delete', id);
    res.redirect('/movies?message=Movie deleted successfully');
  } catch (error) {
    console.error('Error deleting movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  } finally {
    releaseLock(id, txId);
  }
});

// Search movies
app.get('/search', async (req, res) => {
  try {
    const searchParams = {};
    if (req.query.title) searchParams.primaryTitle = req.query.title;
    if (req.query.year) searchParams.startYear = req.query.year;
    if (req.query.genre) searchParams.genres = req.query.genre;
    
    const movies = Object.keys(searchParams).length > 0 
      ? await Movie.getByParameters(searchParams)
      : [];
      
    res.render('movies/index', { 
      movies: movies,
      title: 'Search Results',
      searchQuery: req.query
    });
  } catch (error) {
    console.error('Error searching movies:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).render('error', { 
    error: err,
    title: 'Server Error'
  });
});



// 404 handler (should be last)
// Place this after all other routes and middleware
app.use('*', (req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

app.listen(PORT, () => {
  console.log(`[INFO] Unified server running on http://localhost:${PORT}`);
  console.log(`[INFO] - Web interface: http://localhost:${PORT}/movies`);
  console.log(`[INFO] - API endpoints: http://localhost:${PORT}/api/movies`);
});

module.exports = app;