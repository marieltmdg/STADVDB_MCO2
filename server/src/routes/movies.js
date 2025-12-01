const express = require('express');
const router = express.Router();
const Movie = require('../models/movie');

router.get('/', async (req, res) => {
  try {
    const movies = await Movie.getAll();
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const movie = await Movie.getById(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch movie' });
  }
});

router.post('/', async (req, res) => {
  try {
    const poolId = process.env.NODE_ID || 'node1';
    const newMovie = await Movie.create(poolId, req.body);
    res.status(201).json(newMovie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create movie' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const poolId = process.env.NODE_ID || 'node1';
    const updatedMovie = await Movie.update(poolId, req.params.id, req.body);
    res.json(updatedMovie);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update movie' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const poolId = process.env.NODE_ID || 'node1';
    await Movie.delete(poolId, req.params.id);
    res.json({ message: 'Movie deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete movie' });
  }
});

module.exports = router;
