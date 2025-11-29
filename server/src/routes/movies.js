const express = require('express');
const router = express.Router();
const moviesController = require('../controllers/moviesController');

// Search route must come before the :id route to avoid conflicts
router.get('/search', moviesController.search);

// CRUD routes
router.get('/', moviesController.index);
router.get('/:id', moviesController.show);
router.post('/', moviesController.create);
router.put('/:id', moviesController.update);
router.delete('/:id', moviesController.destroy);

module.exports = router;