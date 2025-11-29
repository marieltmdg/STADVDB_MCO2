const api = require('../services/api');

module.exports = {
  async index(req, res) {
    try {
      const movies = await api.movies.getAll();
      res.render('movies/index', { movies });
    } catch (err) {
      console.error('[ERROR] Failed to load movies page:', err.message);
      res.status(500).render('error', { 
        error: { message: err.message || 'Failed to load movies' }
      });
    }
  },

  async show(req, res) {
    try {
      const movie = await api.movies.getById(req.params.id);
      if (!movie) {
        return res.status(404).render('404');
      }
      res.render('movies/show', { movie });
    } catch (err) {
      console.error('[ERROR] Failed to load movie details:', err.message);
      res.status(500).render('error', { 
        error: { message: err.message || 'Failed to load movie details' }
      });
    }
  },

  newForm(req, res) {
    res.render('movies/new');
  },

  async create(req, res) {
    try {
      const payload = {
        tconst: req.body.tconst,
        titleType: req.body.titleType,
        primaryTitle: req.body.primaryTitle,
        originalTitle: req.body.originalTitle,
        isAdult: req.body.isAdult === 'on' || req.body.isAdult === '1',
        startYear: req.body.startYear || null,
        endYear: req.body.endYear || null,
        runtimeMinutes: req.body.runtimeMinutes || null,
        genres: req.body.genres || null
      };
      
      await api.movies.create(payload);
      res.redirect('/movies');
    } catch (err) {
      console.error('[ERROR] Failed to create movie:', err.message);
      res.status(400).render('movies/new', { 
        error: err.message,
        formData: req.body
      });
    }
  },

  async editForm(req, res) {
    try {
      const movie = await api.movies.getById(req.params.id);
      if (!movie) {
        return res.status(404).render('404');
      }
      res.render('movies/edit', { movie });
    } catch (err) {
      console.error('[ERROR] Failed to load edit form:', err.message);
      res.status(500).render('error', { 
        error: { message: err.message || 'Failed to load edit form' }
      });
    }
  },

  async update(req, res) {
    try {
      const payload = {
        titleType: req.body.titleType,
        primaryTitle: req.body.primaryTitle,
        originalTitle: req.body.originalTitle,
        isAdult: req.body.isAdult === 'on' || req.body.isAdult === '1',
        startYear: req.body.startYear || null,
        endYear: req.body.endYear || null,
        runtimeMinutes: req.body.runtimeMinutes || null,
        genres: req.body.genres || null
      };
      
      await api.movies.update(req.params.id, payload);
      res.redirect('/movies/' + encodeURIComponent(req.params.id));
    } catch (err) {
      console.error('[ERROR] Failed to update movie:', err.message);
      
      if (err.message === 'Movie not found') {
        return res.status(404).render('404');
      }
      
      try {
        const movie = await api.movies.getById(req.params.id);
        res.status(400).render('movies/edit', { 
          movie,
          error: err.message,
          formData: req.body
        });
      } catch {
        res.status(500).render('error', { 
          error: { message: err.message || 'Failed to update movie' }
        });
      }
    }
  },

  async destroy(req, res) {
    try {
      await api.movies.delete(req.params.id);
      res.redirect('/movies');
    } catch (err) {
      console.error('[ERROR] Failed to delete movie:', err.message);
      
      if (err.message === 'Movie not found') {
        return res.status(404).render('404');
      }
      
      res.status(500).render('error', { 
        error: { message: err.message || 'Failed to delete movie' }
      });
    }
  }
};