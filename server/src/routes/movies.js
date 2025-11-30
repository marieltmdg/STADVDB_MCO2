const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');

// GET all movies
router.get('/', async (req, res) => {
  try {
    const movies = await Movie.findAll();
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

// GET movie by ID
router.get('/:id', async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movie' });
  }
});

// CREATE new movie
router.post('/', async (req, res) => {
  try {
    const newMovie = await Movie.create(req.body);
    res.status(201).json(newMovie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create movie' });
  }
});

// UPDATE movie
router.put('/:id', async (req, res) => {
  try {
    const updatedMovie = await Movie.update(req.params.id, req.body);
    res.json(updatedMovie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update movie' });
  }
});

// DELETE movie
router.delete('/:id', async (req, res) => {
  try {
    await Movie.remove(req.params.id);
    res.json({ message: 'Movie deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete movie' });
  }
});

module.exports = router;
