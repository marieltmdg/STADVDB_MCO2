const { resolvePendingLog } = require('./server/src/replication');
const RecoveryLog = require('./server/src/models/recoveryLog');
// Fragmentation middleware
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
app.use('/api', require('./server/src/routes/simulate'));
app.use('/api/recovery', require('./server/src/routes/simulate_recovery'));


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
    const page = parseInt(req.query.page) || 1;
    const limit = 20; // Movies per page
    const offset = (page - 1) * limit;
    
    const movies = await Movie.getAll(limit, offset);
    const totalMovies = await Movie.getCount();
    const totalPages = Math.ceil(totalMovies / limit);
    
    res.render('movies/index', { 
      movies: movies,
      title: 'Movies Database',
      message: req.query.message,
      searchQuery: {}, // Always pass searchQuery
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalMovies: totalMovies,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        nextPage: page + 1,
        prevPage: page - 1
      }
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
app.get('/movies/:id', async (req, res) => {
  const txId = Date.now() + Math.random();
  const id = req.params.id;
  // Debug: show which node is accessed
  console.log(`[DEBUG] Node node1 accessed for read: id=${id}`);
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
app.post('/movies', async (req, res) => {
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
    const poolId = process.env.NODE_ID || 'node1';
    const created = await Movie.create(poolId, movieData);
    
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

app.post('/movies/:id', async (req, res) => {
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

    // Pass the current node as poolId
    const poolId = process.env.NODE_ID || 'node1';
    await Movie.update(poolId, id, updateData);
    
    res.redirect(`/movies/${id}?message=Movie updated successfully`);
  } catch (error) {
    console.error('Error updating movie:', error);
    res.render('error', { error, title: 'Error' });
  } finally {
    releaseLock(id, txId);
  }
});

app.post('/movies/:id/delete', async (req, res) => {
  const txId = Date.now() + Math.random();
  const id = req.params.id;

  // Acquire write lock
  if (!acquireLock(id, 'write', txId)) {
    return res.status(423).send('Resource is locked. Try again later.');
  }

  try {
    const poolId = process.env.NODE_ID || 'node1';
    await Movie.delete(poolId, id);
    
    res.redirect('/movies?message=Movie deleted successfully');
  } catch (error) {
    console.error('Error deleting movie:', error);
    res.render('error', { error, title: 'Error' });
  } finally {
    releaseLock(id, txId);
  }
});


// Search movies
app.get('/search', async (req, res) => {
  try {
    console.log('[DEBUG] Search query params:', req.query);
    const searchParams = {};
    if (req.query.title) searchParams.primaryTitle = req.query.title;
    if (req.query.year) searchParams.startYear = req.query.year;
    if (req.query.genre) searchParams.genres = req.query.genre;
    if (req.query.titleType) searchParams.titleType = req.query.titleType;
    
    console.log('[DEBUG] Search params:', searchParams);
    
    if (Object.keys(searchParams).length === 0) {
      // No search parameters, redirect to movies list
      return res.redirect('/movies');
    }
    
    // Pagination for search results
    const page = parseInt(req.query.page) || 1;
    const limit = 20; // Results per page
    const offset = (page - 1) * limit;
    
    const movies = await Movie.getByParameters(searchParams, limit, offset);
    const totalMovies = await Movie.getCountByParameters(searchParams);
    const totalPages = Math.ceil(totalMovies / limit);
    
    // Build query string for pagination links
    const queryParams = new URLSearchParams();
    if (req.query.title) queryParams.append('title', req.query.title);
    if (req.query.year) queryParams.append('year', req.query.year);
    if (req.query.genre) queryParams.append('genre', req.query.genre);
    if (req.query.titleType) queryParams.append('titleType', req.query.titleType);
    const baseSearchUrl = `/search?${queryParams.toString()}`;
      
    res.render('movies/index', { 
      movies: movies,
      title: 'Search Results',
      searchQuery: req.query,
      pagination: totalPages > 1 ? {
        currentPage: page,
        totalPages: totalPages,
        totalMovies: totalMovies,
        hasNext: page < totalPages,
        hasPrev: page > 1,
        nextPage: page + 1,
        prevPage: page - 1,
        baseUrl: baseSearchUrl
      } : null
    });
  } catch (error) {
    console.error('Error searching movies:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// Concurrency control simulation page
app.get('/simulate', (req, res) => {
    res.render('simulate', { 
        title: 'Concurrency & Replication Simulator',
        DB_NODE1_IP: process.env.DB_NODE1_IP,
        DB_NODE2_IP: process.env.DB_NODE2_IP,
        DB_NODE3_IP: process.env.DB_NODE3_IP
    });
});

// Concurrency control simulation page
app.get('/simulate/recovery', (req, res) => {
  res.render('simulate_recovery', {
    title: 'Concurrency & Replication Simulator',
    DB_NODE1_IP: process.env.DB_NODE1_IP,
    DB_NODE2_IP: process.env.DB_NODE2_IP,
    DB_NODE3_IP: process.env.DB_NODE3_IP
  });
});

// Error handling middleware (after all routes)
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).render('error', { 
    error: err,
    title: 'Server Error'
  });
});

// Reports page
app.get('/reports', async (req, res) => {
  try {
    const reportType = req.query.type || 'genre';
    let reportData = [];
    let reportTitle = '';
    
    switch (reportType) {
      case 'genre':
        reportData = await Movie.getGenreReport();
        reportTitle = 'Movies by Genre';
        break;
      case 'year':
        reportData = await Movie.getYearReport();
        reportTitle = 'Movies by Year';
        break;
      case 'type':
        reportData = await Movie.getTypeReport();
        reportTitle = 'Movies by Type';
        break;
      case 'runtime':
        reportData = await Movie.getRuntimeReport();
        reportTitle = 'Runtime Analysis';
        break;
      default:
        reportData = await Movie.getGenreReport();
        reportTitle = 'Movies by Genre';
    }
    
    res.render('reports/index', {
      title: 'Database Reports',
      reportTitle: reportTitle,
      reportType: reportType,
      reportData: reportData
    });
  } catch (error) {
    console.error('Error loading reports:', error);
    res.render('error', {
      error: error,
      title: 'Error'
    });
  }
});

// 404 handler (last)
app.use('*', (req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

app.listen(PORT, () => {
  console.log(`[INFO] Unified server running on http://localhost:${PORT}`);
});


module.exports = app;