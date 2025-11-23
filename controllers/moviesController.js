const Movie = require('../models/movie');

module.exports = {
  async index(req, res) {
    try {
      const movies = await Movie.getAll();
      res.render('movies/index', { movies });
    } catch (err) {
      res.status(500).send(String(err));
    }
  },

  async show(req, res) {
    try {
      const movie = await Movie.getById(req.params.id);
      if (!movie) return res.status(404).send('Not found');
      res.render('movies/show', { movie });
    } catch (err) {
      res.status(500).send(String(err));
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
      await Movie.create(payload);
      res.redirect('/movies');
    } catch (err) {
      res.status(400).send(String(err));
    }
  },

  async editForm(req, res) {
    try {
      const movie = await Movie.getById(req.params.id);
      if (!movie) return res.status(404).send('Not found');
      res.render('movies/edit', { movie });
    } catch (err) {
      res.status(500).send(String(err));
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
      await Movie.update(req.params.id, payload);
      res.redirect('/movies/' + encodeURIComponent(req.params.id));
    } catch (err) {
      res.status(400).send(String(err));
    }
  },

  async destroy(req, res) {
    try {
      await Movie.delete(req.params.id);
      res.redirect('/movies');
    } catch (err) {
      res.status(500).send(String(err));
    }
  }
};