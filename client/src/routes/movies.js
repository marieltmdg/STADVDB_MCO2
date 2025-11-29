const express = require('express');
const router = express.Router();
const moviesController = require('../controllers/moviesController');

// Display routes
router.get('/', moviesController.index);
router.get('/new', moviesController.newForm);
router.get('/:id', moviesController.show);
router.get('/:id/edit', moviesController.editForm);

// Action routes
router.post('/', moviesController.create);
router.put('/:id', moviesController.update);
router.delete('/:id', moviesController.destroy);

module.exports = router;