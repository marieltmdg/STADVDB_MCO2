require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const expressLayouts = require('express-ejs-layouts');
const Movie = require('./server/src/models/movie');

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
      message: req.query.message 
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
app.get('/movies/:tconst', async (req, res) => {
  try {
    const movie = await Movie.getById(req.params.tconst);
    if (!movie) {
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
  }
});

// Create movie
app.post('/movies', async (req, res) => {
  try {
    const movieData = {
      tconst: req.body.tconst,
      titleType: req.body.titleType,
      primaryTitle: req.body.primaryTitle,
      originalTitle: req.body.originalTitle,
      isAdult: req.body.isAdult === 'on',
      startYear: req.body.startYear ? parseInt(req.body.startYear) : null,
      endYear: req.body.endYear ? parseInt(req.body.endYear) : null,
      runtimeMinutes: req.body.runtimeMinutes ? parseInt(req.body.runtimeMinutes) : null,
      genres: req.body.genres
    };
    
    await Movie.create(movieData);
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
app.get('/movies/:tconst/edit', async (req, res) => {
  try {
    const movie = await Movie.getById(req.params.tconst);
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
app.post('/movies/:tconst', async (req, res) => {
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
    
    await Movie.update(req.params.tconst, updateData);
    res.redirect(`/movies/${req.params.tconst}?message=Movie updated successfully`);
  } catch (error) {
    console.error('Error updating movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
  }
});

// Delete movie
app.post('/movies/:tconst/delete', async (req, res) => {
  try {
    await Movie.delete(req.params.tconst);
    res.redirect('/movies?message=Movie deleted successfully');
  } catch (error) {
    console.error('Error deleting movie:', error);
    res.render('error', { 
      error: error,
      title: 'Error'
    });
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