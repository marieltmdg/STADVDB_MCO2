const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');

// GET /api/movies - Get all movies
router.get('/', async (req, res) => {
  try {
    const movies = await Movie.getAll();
    res.json(movies);
  } catch (error) {
    console.error('Error getting movies:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/movies/search - Search movies
router.get('/search', async (req, res) => {
  try {
    const movies = await Movie.getByParameters(req.query);
    res.json(movies);
  } catch (error) {
    console.error('Error searching movies:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/movies/:id - Get movie by ID
router.get('/:id', async (req, res) => {
  try {
    const movie = await Movie.getById(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    res.json(movie);
  } catch (error) {
    console.error('Error getting movie:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/movies - Create new movie
router.post('/', async (req, res) => {
  try {
    const movie = await Movie.create(req.body);
    res.status(201).json(movie);
  } catch (error) {
    console.error('Error creating movie:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/movies/:id - Update movie
router.put('/:id', async (req, res) => {
  try {
    const affectedRows = await Movie.update(req.params.id, req.body);
    if (affectedRows === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    const updatedMovie = await Movie.getById(req.params.id);
    res.json(updatedMovie);
  } catch (error) {
    console.error('Error updating movie:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/movies/:id - Delete movie
router.delete('/:id', async (req, res) => {
  try {
    const affectedRows = await Movie.delete(req.params.id);
    if (affectedRows === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    res.json({ message: 'Movie deleted successfully' });
  } catch (error) {
    console.error('Error deleting movie:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;