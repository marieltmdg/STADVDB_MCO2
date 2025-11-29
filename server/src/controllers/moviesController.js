const Movie = require('../models/movie');

module.exports = {
  // GET /api/movies
  async index(req, res) {
    try {
      const movies = await Movie.getAll();
      res.json({
        success: true,
        data: movies,
        count: movies.length
      });
    } catch (err) {
      console.error('[ERROR] Failed to fetch movies:', err.message);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  },

  // GET /api/movies/:id
  async show(req, res) {
    try {
      const movie = await Movie.getById(req.params.id);
      if (!movie) {
        return res.status(404).json({
          success: false,
          error: 'Movie not found'
        });
      }
      res.json({
        success: true,
        data: movie
      });
    } catch (err) {
      console.error('[ERROR] Failed to fetch movie:', err.message);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  },

  // POST /api/movies
  async create(req, res) {
    try {
      const {
        tconst,
        titleType,
        primaryTitle,
        originalTitle,
        isAdult,
        startYear,
        endYear,
        runtimeMinutes,
        genres
      } = req.body;

      const payload = {
        tconst,
        titleType,
        primaryTitle,
        originalTitle,
        isAdult: isAdult === 'true' || isAdult === true || isAdult === 1,
        startYear: startYear ? Number(startYear) : null,
        endYear: endYear ? Number(endYear) : null,
        runtimeMinutes: runtimeMinutes ? Number(runtimeMinutes) : null,
        genres
      };

      const movie = await Movie.create(payload);
      res.status(201).json({
        success: true,
        data: movie,
        message: 'Movie created successfully'
      });
    } catch (err) {
      console.error('[ERROR] Failed to create movie:', err.message);
      res.status(400).json({
        success: false,
        error: err.message
      });
    }
  },

  // PUT /api/movies/:id
  async update(req, res) {
    try {
      const {
        titleType,
        primaryTitle,
        originalTitle,
        isAdult,
        startYear,
        endYear,
        runtimeMinutes,
        genres
      } = req.body;

      const payload = {
        titleType,
        primaryTitle,
        originalTitle,
        isAdult: isAdult === 'true' || isAdult === true || isAdult === 1,
        startYear: startYear ? Number(startYear) : null,
        endYear: endYear ? Number(endYear) : null,
        runtimeMinutes: runtimeMinutes ? Number(runtimeMinutes) : null,
        genres
      };

      const result = await Movie.update(req.params.id, payload);
      
      if (result === 0) {
        return res.status(404).json({
          success: false,
          error: 'Movie not found'
        });
      }

      res.json({
        success: true,
        message: 'Movie updated successfully'
      });
    } catch (err) {
      console.error('[ERROR] Failed to update movie:', err.message);
      res.status(400).json({
        success: false,
        error: err.message
      });
    }
  },

  // DELETE /api/movies/:id
  async destroy(req, res) {
    try {
      const result = await Movie.delete(req.params.id);
      
      if (result === 0) {
        return res.status(404).json({
          success: false,
          error: 'Movie not found'
        });
      }

      res.json({
        success: true,
        message: 'Movie deleted successfully'
      });
    } catch (err) {
      console.error('[ERROR] Failed to delete movie:', err.message);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  },

  // GET /api/movies/search
  async search(req, res) {
    try {
      const params = req.query;
      const movies = await Movie.getByParameters(params);
      res.json({
        success: true,
        data: movies,
        count: movies.length,
        filters: params
      });
    } catch (err) {
      console.error('[ERROR] Failed to search movies:', err.message);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }
};